import random
import logging
import dataclasses

from .actor import Actor, Player
from .actions import MeleeAttackAction, MoveAction, PickupItemAction


log = logging.getLogger(__name__)


@dataclasses.dataclass(init=False)
class NPC(Actor):
    KEY = None
    NAME = None

    def __init__(self, *args, **kwargs):
        if "name" not in kwargs:
            kwargs["name"] = self.NAME
        super(NPC, self).__init__(self.KEY, *args, **kwargs)

    def hurt(self, actor, damage):
        self.target = actor

    def get_action(self, world):
        if not self.target:
            for actor in world.surrounding_actors(self):
                self.target = actor
        area = world.get_area(self)
        objs = [obj for obj in area.get_objects(self.x, self.y) if not isinstance(obj, Actor)]
        if self.target:
            action = MeleeAttackAction(self.target)
            self.target = None
        elif objs and self.has_inventory_space:
            return PickupItemAction()
        else:
            action = None

            for _ in range(10):
                dx, dy = random.randint(-1, 1), random.randint(-1, 1)
                x = self.x + dx
                y = self.y + dy
                if area.is_tile_free(x, y):
                    action = MoveAction(dx, dy)
                    break

        return action


@dataclasses.dataclass(init=False)
class Orc(NPC):
    KEY = "orc1"
    NAME = "orc"


@dataclasses.dataclass(init=False)
class Skeleton(NPC):
    KEY = "skeleton1"
    NAME = "skeleton"
