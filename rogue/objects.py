import abc
import enum
import random
import dataclasses
from typing import List, Dict
import logging
import bson

log = logging.getLogger(__name__)


class ActionError(Exception):
    pass


class BodyPart(enum.Enum):
    Hand = 1
    Feet = 2
    Head = 3
    Torso = 4
    Neck = 5

    LeftHand = 6
    RightHand = 7


@dataclasses.dataclass
class Object(object):
    key: str
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


class Coin(Object):
    pass


class Item(Object, metaclass=abc.ABCMeta):
    @abc.abstractmethod
    def apply(self):
        pass


class Equipment(Object, metaclass=abc.ABCMeta):
    EQUIPS = None


class Weapon(Equipment):
    EQUIPS = BodyPart.Hand


class Armor(Equipment):
    pass


class Sword(Weapon):
    damage: int = 6


class Shield(Armor):
    EQUIPS = BodyPart.Hand
    damage: int = 2


class ActorState(enum.Enum):
    ALIVE = 1
    UNCONSCIOUS = 2
    DEAD = 3


@dataclasses.dataclass
class Actor(Object):
    name: str = None

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
        return BodyPart.RightHand in self.equipment

    @property
    def has_shield(self):
        return BodyPart.LeftHand in self.equipment

    @property
    def weapon(self):
        return self.equipment.get(BodyPart.RightHand)

    @property
    def shield(self):
        return self.equipment.get(BodyPart.LeftHand)

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

    def equip(self, obj, part=None):
        if not isinstance(obj, Equipment) or (part and obj.EQUIPS != part):
            raise ActionError("cannot equip this")

        if isinstance(obj, Weapon):
            part = BodyPart.RightHand
        elif isinstance(obj, Shield):
            part = BodyPart.LeftHand
        elif not part:
            part = obj.EQUIPS

        self.equipment[part] = obj

        self.notice("you equipped a {} to your {}".format(obj, part.name))
        return part


@dataclasses.dataclass
class Player(Actor):
    """
    Base class for interactive actors
    """


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
