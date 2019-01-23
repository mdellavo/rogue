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


@dataclasses.dataclass
class Actor(Object):
    view_distance: int = 5
    parts: List[BodyPart] = dataclasses.field(default_factory=list)
    name: str = None
    inventory: List[Object] = dataclasses.field(default_factory=list)
    max_inventory: int = 20
    anchored: bool = True
    blocks: bool = True

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
        for _ in range(100):
            if world.move(self, random.randint(-1, 1), random.randint(-1, 1)):
                break

