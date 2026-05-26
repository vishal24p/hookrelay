def _header_value(headers: dict | None, name: str) -> str | None:
    if not headers:
        return None
    expected = name.lower()
    for key, value in headers.items():
        if str(key).lower() == expected:
            return str(value)
    return None


def find_duplicate_event_id_in_previous_events(
    previous_events,
    provider_event_id: str | None,
    event_id_header: str,
) -> int | None:
    if not provider_event_id:
        return None

    for previous_event in previous_events:
        previous_event_id = _header_value(getattr(previous_event, "headers", None), event_id_header)
        if previous_event_id == provider_event_id:
            return getattr(previous_event, "id", None)
    return None
