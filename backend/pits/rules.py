"""鞣坑门槛：放液看最近一次浸液酸碱度 3.5～5.0；注液改鞣制中看在用转速卡 8～14 转/分。"""

from pits.models import DrumCard, Pit

MIN_PH = 3.5
MAX_PH = 5.0
MIN_RPM = 8
MAX_RPM = 14


class RuleError(ValueError):
    pass


def latest_ph(pit: Pit) -> float | None:
    sample = pit.samples.order_by("-taken_at", "-id").first()
    return None if sample is None else sample.ph


def latest_active_card(pit: Pit) -> DrumCard | None:
    return pit.drum_cards.filter(voided_at__isnull=True).order_by("-measured_at", "-id").first()


def assert_can_set_status(pit: Pit, new_status: str) -> None:
    allowed = {Pit.STATUS_FILL, Pit.STATUS_TANNING, Pit.STATUS_DRAINED}
    if new_status not in allowed:
        raise RuleError(f"无效状态：{new_status}")
    if new_status == Pit.STATUS_TANNING and pit.status == Pit.STATUS_FILL:
        card = latest_active_card(pit)
        if card is None:
            raise RuleError("该坑尚无在用转速卡，不能改鞣制中")
        if card.rpm < MIN_RPM or card.rpm > MAX_RPM:
            raise RuleError(f"在用转速 {card.rpm} 转/分不在 {MIN_RPM}～{MAX_RPM}，不能改鞣制中")
    if new_status == Pit.STATUS_DRAINED:
        ph = latest_ph(pit)
        if ph is None:
            raise RuleError("该坑尚无浸液酸碱记录，不能放液")
        if ph < MIN_PH or ph > MAX_PH:
            raise RuleError(f"最近酸碱度 {ph} 不在 {MIN_PH}～{MAX_PH}，不能放液")
