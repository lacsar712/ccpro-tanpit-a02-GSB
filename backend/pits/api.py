from django.db import IntegrityError
from django.utils import timezone
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from pits.auth import BearerAuth, make_token
from pits.models import DrumCard, Pit, User, Yard
from pits.rules import RuleError, assert_can_set_status, latest_active_card, latest_ph

api = NinjaAPI(title="TanPit", urls_namespace="tanpit")
auth = BearerAuth()


class LoginIn(Schema):
    username: str
    password: str


class SampleIn(Schema):
    ph: float


class StatusIn(Schema):
    status: str


class CardIn(Schema):
    pit_id: int
    card_no: int
    rpm: int


def pit_json(pit: Pit) -> dict:
    card = latest_active_card(pit)
    return {
        "id": pit.id,
        "code": pit.code,
        "status": pit.status,
        "row": pit.row,
        "col": pit.col,
        "latestPh": latest_ph(pit),
        "sampleCount": pit.samples.count(),
        "latestRpm": None if card is None else card.rpm,
        "latestCardNo": None if card is None else card.card_no,
    }


def card_json(card: DrumCard) -> dict:
    return {
        "id": card.id,
        "pitId": card.pit_id,
        "pitCode": card.pit.code,
        "cardNo": card.card_no,
        "rpm": card.rpm,
        "measurer": card.measurer,
        "measuredAt": card.measured_at.isoformat(),
        "voidedBy": card.voided_by or None,
        "voidedAt": None if card.voided_at is None else card.voided_at.isoformat(),
    }


@api.post("/auth/login")
def login(request, payload: LoginIn):
    user = User.objects.filter(username=payload.username).first()
    if user is None or not user.check_password(payload.password):
        raise HttpError(401, "用户名或密码错误")
    return {"access_token": make_token(user.username), "user": {"username": user.username, "role": user.role}}


@api.get("/auth/me", auth=auth)
def me(request):
    user = request.auth
    return {"username": user.username, "role": user.role}


@api.get("/health")
def health(request):
    return {"status": "ok", "service": "TanPit"}


@api.get("/board", auth=auth)
def board(request):
    yard = Yard.objects.prefetch_related("pits__samples").first()
    if yard is None:
        raise HttpError(404, "尚无鞣场")
    pits = sorted(yard.pits.all(), key=lambda p: (p.row, p.col))
    return {"yard": yard.name, "village": yard.village, "pits": [pit_json(p) for p in pits]}


@api.post("/pits/{pit_id}/samples", auth=auth)
def add_sample(request, pit_id: int, payload: SampleIn):
    pit = Pit.objects.filter(id=pit_id).first()
    if pit is None:
        raise HttpError(404, "坑不存在")
    pit.samples.create(ph=payload.ph, operator=request.auth.username)
    pit.refresh_from_db()
    return pit_json(pit)


@api.post("/pits/{pit_id}/status", auth=auth)
def set_status(request, pit_id: int, payload: StatusIn):
    pit = Pit.objects.filter(id=pit_id).first()
    if pit is None:
        raise HttpError(404, "坑不存在")
    try:
        assert_can_set_status(pit, payload.status)
    except RuleError as exc:
        raise HttpError(400, str(exc))
    pit.status = payload.status
    pit.save(update_fields=["status"])
    return pit_json(pit)


@api.get("/cards", auth=auth)
def list_cards(request, pit_id: int | None = None):
    qs = DrumCard.objects.select_related("pit").order_by("-measured_at", "-id")
    if pit_id is not None:
        qs = qs.filter(pit_id=pit_id)
    return {"cards": [card_json(c) for c in qs]}


@api.post("/cards", auth=auth)
def create_card(request, payload: CardIn):
    if payload.card_no < 1:
        raise HttpError(400, "卡号须为从 1 起的正整数")
    if payload.rpm < 1:
        raise HttpError(400, "每分钟转数须为正整数")
    pit = Pit.objects.filter(id=payload.pit_id).first()
    if pit is None:
        raise HttpError(404, "坑不存在")
    try:
        card = DrumCard.objects.create(
            pit=pit,
            card_no=payload.card_no,
            rpm=payload.rpm,
            measurer=request.auth.username,
        )
    except IntegrityError:
        raise HttpError(409, f"{pit.code} 的 {payload.card_no} 号卡正在使用，请换未占用的卡号")
    return card_json(card)


@api.post("/cards/{card_id}/void", auth=auth)
def void_card(request, card_id: int):
    if request.auth.role != "admin":
        raise HttpError(403, "仅值班长可作废转速卡")
    card = DrumCard.objects.filter(id=card_id).first()
    if card is None:
        raise HttpError(404, "转速卡不存在")
    if card.voided_at is None:
        card.voided_at = timezone.now()
        card.voided_by = request.auth.username
        card.save(update_fields=["voided_at", "voided_by"])
    return card_json(card)
