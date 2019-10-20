import random
import logging
import dataclasses

from .actor import Actor, Player
from .actions import MeleeAttackAction, MoveAction


log = logging.getLogger(__name__)


@dataclasses.dataclass
class NPC(Actor):

    def hurt(self, actor, damage):
        self.target = actor

    def get_action(self, world):
        if not self.target:
            for actor in world.surrounding_actors(self):
                self.target = actor

        if self.target:
            action = MeleeAttackAction(self.target)
            self.target = None
        else:
            action = None

            for _ in range(10):
                dx, dy = random.randint(-1, 1), random.randint(-1, 1)
                x = self.x + dx
                y = self.y + dy
                area = world.get_area(self)
                if area.is_tile_free(x, y):
                    action = MoveAction(dx, dy)
                    break

        return action
