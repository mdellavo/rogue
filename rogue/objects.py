import enum
import random
import dataclasses
from typing import List


class BodyPart(enum.Enum):
    Hands = 1
    Feet = 2
    Head = 3
    Torso = 4
    Neck = 5


@dataclasses.dataclass
class Object(object):
    key: str
    x: int = None
    y: int = None
    blocks: bool = False
    blocks_sight: bool = False
    anchored: bool = False

    def tick(self, world):
        pass


class Coin(Object):
    pass


class ActorState(enum.Enum):
    ALIVE = 1
    UNCONSCIOUS = 2
    DEAD = 3


@dataclasses.dataclass
class Actor(Object):
    name: str = None

    anchored: bool = True
    blocks: bool = True

    parts: List[BodyPart] = dataclasses.field(default_factory=list)
    inventory: List[Object] = dataclasses.field(default_factory=list)

    view_distance: int = 5
    strength: int = 5
    armor_class: int = 10
    health: int = 50
    hit_points: int = health

    max_inventory: int = 20

    @property
    def alive(self):
        if self.hit_points > 0:
            return ActorState.ALIVE
        elif self.hit_points <= 0 and abs(self.hit_points) < self.health:
            return ActorState.UNCONSCIOUS
        else:
            return ActorState.DEAD

    def notice(self, msg, **kwargs):
        pass

    def pickup(self, obj):
        if obj in self.inventory:
            raise ValueError("actor already holding obj")

        if len(self.inventory) < self.max_inventory:
            self.inventory.append(obj)

    def drop(self, obj):
        if obj not in self.inventory:
            raise ValueError("actor not holding obj")
        self.inventory.remove(obj)
        obj.x = self.x
        obj.y = self.y


@dataclasses.dataclass
class NPC(Actor):
    def tick(self, world):
        if not world.age % random.randint(5, 10):
            for _ in range(100):
                if world.move(self, random.randint(-1, 1), random.randint(-1, 1)):
                    break
