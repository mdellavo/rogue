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
            actors = [actor for actor in world.surrounding_actors(self) if isinstance(actor, Player)]
            if actors:
                self.target = random.choice(actors)

        if self.target:
            action = MeleeAttackAction(self)
            self.target = None
        else:
            action = MoveAction(random.randint(-1, 1), random.randint(-1, 1))

        return action
