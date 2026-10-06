from django.contrib.auth.hashers import check_password, make_password
from django.db import models


class User(models.Model):
    username = models.CharField(max_length=64, unique=True)
    password_hash = models.CharField(max_length=256)
    role = models.CharField(max_length=20, default="worker")

    def set_password(self, raw: str) -> None:
        self.password_hash = make_password(raw)

    def check_password(self, raw: str) -> bool:
        return check_password(raw, self.password_hash)


class Yard(models.Model):
    name = models.CharField(max_length=120)
    village = models.CharField(max_length=120, blank=True)


class Pit(models.Model):
    STATUS_FILL = "fill"
    STATUS_TANNING = "tanning"
    STATUS_DRAINED = "drained"

    yard = models.ForeignKey(Yard, on_delete=models.CASCADE, related_name="pits")
    code = models.CharField(max_length=40)
    status = models.CharField(max_length=20, default=STATUS_FILL)
    row = models.IntegerField(default=0)
    col = models.IntegerField(default=0)

    class Meta:
        unique_together = ("yard", "code")


class LiquorSample(models.Model):
    pit = models.ForeignKey(Pit, on_delete=models.CASCADE, related_name="samples")
    taken_at = models.DateTimeField(auto_now_add=True)
    ph = models.FloatField()
    operator = models.CharField(max_length=64, blank=True)


class DrumCard(models.Model):
    """转速卡：每坑一列卡号（从 1 起），同坑在用卡号唯一。"""

    pit = models.ForeignKey(Pit, on_delete=models.CASCADE, related_name="drum_cards")
    card_no = models.PositiveIntegerField()
    rpm = models.PositiveIntegerField()
    measurer = models.CharField(max_length=64)
    measured_at = models.DateTimeField(auto_now_add=True)
    voided_by = models.CharField(max_length=64, blank=True, default="")
    voided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("pit", "card_no"),
                condition=models.Q(voided_at__isnull=True),
                name="uniq_active_card_no_per_pit",
            )
        ]
