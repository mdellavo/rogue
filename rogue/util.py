import random
import string
from enum import Enum


class StrEnum(str, Enum):
    pass


def project_enum(e):
    return e.name.lower().replace("_", " ")


def generate_uid(length=8):
    return "".join([random.choice(string.ascii_lowercase) for _ in range(length)])
