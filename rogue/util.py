from enum import Enum


class StrEnum(str, Enum):
    pass


def project_enum(e):
    return e.name.lower().replace("_", " ")
