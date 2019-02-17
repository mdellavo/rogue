import abc
import enum
import random
import dataclasses
from typing import List, Dict
import logging
import bson

from .util import _project_enum

log = logging.getLogger(__name__)


class ActionError(Exception):
    pass


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

    id: str = dataclasses.field(default_factory=lambda: str(bson.ObjectId()))

    def tick(self, world):
        self.age += 1

    def __str__(self):
        return type(self).__name__.lower()

    def get_object_type(self):
        return


class Coin(Object):
    name = "coin"
    object_type: ObjectTypes = ObjectTypes.COIN


class Item(Object):
    object_type: ObjectTypes = ObjectTypes.ITEM

    @abc.abstractmethod
    def use(self, actor):
        pass


class HealthPotion(Item):
    name = "health potion"
    value: int = 10

    def use(self, actor):
        actor.hit_points = min(actor.hit_points + self.value, actor.health)
        actor.healed(actor, self.value)


class Equipment(Object):
    equips: BodyPart = None
    object_type: ObjectTypes = ObjectTypes.EQUIPMENT


class Weapon(Equipment):
    equips = BodyPart.HAND


class Armor(Equipment):
    name = "armor"
    equips = BodyPart.TORSO


class Sword(Weapon):
    name = "sword"
    damage: int = 6


class Shield(Armor):
    name = "shield"
    equips = BodyPart.HAND
    damage: int = 2


class ActorState(enum.Enum):
    ALIVE = 1
    UNCONSCIOUS = 2
    DEAD = 3


@dataclasses.dataclass
class Actor(Object):
    born: float = 0
    anchored: bool = True
    blocks: bool = True

    inventory: List[Object] = dataclasses.field(default_factory=list)

    view_distance: int = 5
    strength: int = 5
    armor_class: int = 1
    health: int = 50
    hit_points: int = health

    max_inventory: int = 20

    kills: int = 0

    equipment: Dict[BodyPart, Equipment] = dataclasses.field(default_factory=dict)

    @property
    def has_weapon(self):
        return BodyPart.RIGHT_HAND in self.equipment

    @property
    def has_shield(self):
        return BodyPart.LEFT_HAND in self.equipment

    @property
    def weapon(self):
        return self.equipment.get(BodyPart.RIGHT_HAND)

    @property
    def shield(self):
        return self.equipment.get(BodyPart.LEFT_HAND)

    @property
    def is_alive(self) -> bool:
        return self.state == ActorState.ALIVE

    @property
    def state(self) -> ActorState:
        if self.hit_points > 0:
            return ActorState.ALIVE
        elif self.hit_points <= 0 and abs(self.hit_points) < self.health:
            return ActorState.UNCONSCIOUS
        else:
            return ActorState.DEAD

    def healed(self, actor, damage):
        pass

    def hurt(self, actor, damage):
        pass

    def die(self):
        pass

    def notice(self, msg, **kwargs):
        pass

    def pickup(self, obj):
        if obj in self.inventory:
            raise ActionError("actor already holding obj")

        if len(self.inventory) < self.max_inventory:
            self.inventory.append(obj)

    def drop(self, obj):
        if obj not in self.inventory:
            raise ActionError("actor not holding obj")
        self.inventory.remove(obj)
        obj.x = self.x
        obj.y = self.y

    def use(self, obj):
        if not isinstance(obj, Item):
            raise ActionError("cannot use this")

        obj.use(self)

    def equip(self, obj, part=None):
        if not isinstance(obj, Equipment) or (part and obj.equips != part):
            raise ActionError("cannot equip this")

        if isinstance(obj, Weapon):
            part = BodyPart.RIGHT_HAND
        elif isinstance(obj, Shield):
            part = BodyPart.LEFT_HAND
        elif not part:
            part = obj.equips

        self.equipment[part] = obj

        self.notice("you equipped a {} to your {}".format(obj, _project_enum(part)))
        return part


@dataclasses.dataclass
class Player(Actor):
    """
    Base class for interactive actors
    """

    def find_object_by_id(self, id_):
        return next((o for o in self.inventory if o.id == id_), None)


@dataclasses.dataclass
class NPC(Actor):

    def __init__(self, *args, **kwargs):
        super(NPC, self).__init__(*args, **kwargs)
        self.target = None
        self.sleep_for = random.randint(5, 10)

    def hurt(self, actor, damage):
        self.target = actor

    def tick(self, world):
        super(NPC, self).tick(world)

        if self.age % self.sleep_for:
            return

        self.sleep_for = random.randint(5, 10)

        if not self.target:
            actors = [actor for actor in world.surrounding_actors(self) if isinstance(actor, Player)]
            if actors:
                self.target = random.choice(actors)

        if self.target:
            world.melee(self)
            self.target = None
            return

        for _ in range(100):
            if world.move(self, random.randint(-1, 1), random.randint(-1, 1)):
                break
