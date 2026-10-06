"""转速卡与鞣制门槛的验收测试。"""

import json
import threading

from django.db import connections
from django.test import Client, TestCase, TransactionTestCase

from pits.auth import make_token
from pits.models import DrumCard, Pit, User
from pits.rules import RuleError, assert_can_set_status
from pits.seed import seed_demo


def auth_client(username):
    c = Client()
    c.defaults["HTTP_AUTHORIZATION"] = f"Bearer {make_token(username)}"
    return c


class SeedTest(TestCase):
    def test_seed_has_one_fill_pit_and_zero_cards(self):
        seed_demo()
        self.assertEqual(Pit.objects.filter(status=Pit.STATUS_FILL).count(), 1)
        self.assertEqual(DrumCard.objects.count(), 0)


class TanningGateTest(TestCase):
    def setUp(self):
        seed_demo()
        self.pit = Pit.objects.get(status=Pit.STATUS_FILL)

    def gate(self):
        assert_can_set_status(self.pit, Pit.STATUS_TANNING)

    def test_no_card_blocks_tanning(self):
        with self.assertRaises(RuleError):
            self.gate()

    def test_rpm_6_is_not_qualified(self):
        self.pit.drum_cards.create(card_no=1, rpm=6, measurer="worker")
        with self.assertRaises(RuleError):
            self.gate()
        self.pit.refresh_from_db()
        self.assertEqual(self.pit.status, Pit.STATUS_FILL)

    def test_rpm_band_edges(self):
        for rpm, ok in [(7, False), (8, True), (14, True), (15, False)]:
            DrumCard.objects.all().delete()
            self.pit.drum_cards.create(card_no=1, rpm=rpm, measurer="worker")
            if ok:
                self.gate()  # 不抛错即通过
            else:
                with self.assertRaises(RuleError):
                    self.gate()

    def test_qualified_card_allows_tanning(self):
        self.pit.drum_cards.create(card_no=1, rpm=10, measurer="worker")
        self.gate()

    def test_voided_card_does_not_count(self):
        card = self.pit.drum_cards.create(card_no=1, rpm=10, measurer="worker")
        card.voided_at = card.measured_at
        card.voided_by = "admin"
        card.save()
        with self.assertRaises(RuleError):
            self.gate()


class DrainedGateTest(TestCase):
    """已放液继续只认酸碱带，转速卡不得掺进已放液。"""

    def setUp(self):
        seed_demo()

    def test_drained_ignores_missing_card(self):
        pit = Pit.objects.get(code="东-1")  # 最近酸碱度 4.2，无转速卡
        assert_can_set_status(pit, Pit.STATUS_DRAINED)

    def test_card_does_not_help_drained(self):
        pit = Pit.objects.get(code="中-2")  # 最近酸碱度 6.1，出区间
        pit.drum_cards.create(card_no=1, rpm=10, measurer="worker")
        with self.assertRaises(RuleError):
            assert_can_set_status(pit, Pit.STATUS_DRAINED)


class CardApiTest(TestCase):
    def setUp(self):
        seed_demo()
        self.pit = Pit.objects.get(status=Pit.STATUS_FILL)

    def test_worker_can_create_card(self):
        res = auth_client("worker").post(
            "/api/cards",
            data=json.dumps({"pit_id": self.pit.id, "card_no": 1, "rpm": 12}),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        card = DrumCard.objects.get()
        self.assertEqual(card.measurer, "worker")
        self.assertIsNotNone(card.measured_at)
        self.assertIsNone(card.voided_at)

    def test_card_no_and_rpm_must_be_positive_int(self):
        for payload in [
            {"pit_id": self.pit.id, "card_no": 0, "rpm": 12},
            {"pit_id": self.pit.id, "card_no": 1, "rpm": 0},
            {"pit_id": self.pit.id, "card_no": 1, "rpm": 10.5},
        ]:
            res = auth_client("worker").post("/api/cards", data=json.dumps(payload), content_type="application/json")
            self.assertEqual(res.status_code, 422, payload)
        self.assertEqual(DrumCard.objects.count(), 0)

    def test_duplicate_active_card_no_rejected(self):
        c = auth_client("worker")
        body = json.dumps({"pit_id": self.pit.id, "card_no": 1, "rpm": 12})
        self.assertEqual(c.post("/api/cards", data=body, content_type="application/json").status_code, 200)
        res = c.post("/api/cards", data=body, content_type="application/json")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(DrumCard.objects.filter(voided_at__isnull=True).count(), 1)

    def test_voided_card_no_can_be_reused(self):
        c = auth_client("admin")
        body = json.dumps({"pit_id": self.pit.id, "card_no": 1, "rpm": 12})
        card_id = c.post("/api/cards", data=body, content_type="application/json").json()["id"]
        self.assertEqual(c.post(f"/api/cards/{card_id}/void").status_code, 200)
        self.assertEqual(c.post("/api/cards", data=body, content_type="application/json").status_code, 200)
        self.assertEqual(DrumCard.objects.count(), 2)
        self.assertEqual(DrumCard.objects.filter(voided_at__isnull=True).count(), 1)

    def test_only_leader_can_void(self):
        card_id = auth_client("worker").post(
            "/api/cards",
            data=json.dumps({"pit_id": self.pit.id, "card_no": 1, "rpm": 12}),
            content_type="application/json",
        ).json()["id"]
        self.assertEqual(auth_client("worker").post(f"/api/cards/{card_id}/void").status_code, 403)
        res = auth_client("admin").post(f"/api/cards/{card_id}/void")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["voidedBy"], "admin")
        self.assertIsNotNone(res.json()["voidedAt"])

    def test_list_filter_by_pit(self):
        other = Pit.objects.get(code="东-1")
        self.pit.drum_cards.create(card_no=1, rpm=12, measurer="worker")
        other.drum_cards.create(card_no=1, rpm=9, measurer="worker")
        all_cards = auth_client("worker").get("/api/cards").json()
        self.assertEqual(len(all_cards), 2)
        filtered = auth_client("worker").get(f"/api/cards?pit_id={self.pit.id}").json()
        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]["pitCode"], self.pit.code)

    def test_status_endpoint_enforces_gate(self):
        c = auth_client("worker")
        body = json.dumps({"status": "tanning"})
        res = c.post(f"/api/pits/{self.pit.id}/status", data=body, content_type="application/json")
        self.assertEqual(res.status_code, 400)
        self.pit.drum_cards.create(card_no=1, rpm=6, measurer="worker")
        res = c.post(f"/api/pits/{self.pit.id}/status", data=body, content_type="application/json")
        self.assertEqual(res.status_code, 400)
        DrumCard.objects.all().delete()
        self.pit.drum_cards.create(card_no=1, rpm=11, measurer="worker")
        res = c.post(f"/api/pits/{self.pit.id}/status", data=body, content_type="application/json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "tanning")


class CardRaceTest(TransactionTestCase):
    """两名测定几乎同时抢交同一卡号：后到的那笔必须落空，只留一张。"""

    def test_concurrent_same_card_no_leaves_one_card(self):
        seed_demo()
        pit = Pit.objects.get(status=Pit.STATUS_FILL)
        barrier = threading.Barrier(2)
        results = []

        def submit(username):
            try:
                barrier.wait(timeout=10)
                res = auth_client(username).post(
                    "/api/cards",
                    data=json.dumps({"pit_id": pit.id, "card_no": 1, "rpm": 12}),
                    content_type="application/json",
                )
                results.append(res.status_code)
            finally:
                connections.close_all()

        threads = [threading.Thread(target=submit, args=(u,)) for u in ("admin", "worker")]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
            self.assertFalse(t.is_alive())

        self.assertEqual(sorted(results), [200, 409])
        self.assertEqual(DrumCard.objects.filter(pit=pit, card_no=1, voided_at__isnull=True).count(), 1)
