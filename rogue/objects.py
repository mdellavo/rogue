import abc
import enum
import dataclasses
import logging

from . import util


log = logging.getLogger(__name__)


class BodyPart(enum.Enum):
    HAND = 1
    FEET = 2
    HEAD = 3
    TORSO = 4
    NECK = 5  # protect it

    LEFT_HAND = 6
    RIGHT_HAND = 7


class ObjectTypes(enum.Enum):
    UNSPECIFIED = 0
    EQUIPMENT = 1
    ITEM = 2
    COIN = 3


@dataclasses.dataclass
class Object(object, metaclass=abc.ABCMeta):
    key: str
    name: str = None
    object_type: ObjectTypes = ObjectTypes.UNSPECIFIED
    x: int = None
    y: int = None
    blocks: bool = False
    blocks_sight: bool = False
    anchored: bool = False
    age: int = 0

    id: str = dataclasses.field(default_factory=util.generate_uid)

    def __str__(self):
        return self.name

    def get_object_type(self):
        return None

    @property
    def pos(self):
        return self.x, self.y


@dataclasses.dataclass
class Coin(Object):
    name: str = "coin"
    object_type: ObjectTypes = ObjectTypes.COIN


@dataclasses.dataclass
class Item(Object):
    object_type: ObjectTypes = ObjectTypes.ITEM

    @abc.abstractmethod
    def use(self, actor):
        pass


@dataclasses.dataclass
class HealthPotion(Item):
    name: str = "health potion"
    value: int = 10

    def use(self, actor):
        actor.attributes.hit_points = min(actor.attributes.hit_points + self.value, actor.attributes.health)
        actor.healed(actor, self.value)


@dataclasses.dataclass
class Equipment(Object):
    equips: BodyPart = None
    object_type: ObjectTypes = ObjectTypes.EQUIPMENT


@dataclasses.dataclass
class Weapon(Equipment):
    equips = BodyPart.HAND


@dataclasses.dataclass
class Armor(Equipment):
    name: str = "armor"
    equips = BodyPart.TORSO


@dataclasses.dataclass
class Sword(Weapon):
    equips: BodyPart = BodyPart.HAND
    name: str = "sword"
    damage: int = 6


@dataclasses.dataclass
class Shield(Equipment):
    name: str = "shield"
    equips = BodyPart.HAND
    damage: int = 2


