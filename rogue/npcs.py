import random
import dataclasses

from .actor import Actor, Player
from .actions import MeleeAttackAction, MoveAction


@dataclasses.dataclass
class NPC(Actor):

    def __init__(self, *args, **kwargs):
        super(NPC, self).__init__(*args, **kwargs)
        self.target = None
        self.sleep_for = random.randint(5, 10)

    def hurt(self, actor, damage):
        self.target = actor

    def get_action(self, world):
        if self.age % self.sleep_for:
            return None

        self.sleep_for = random.randint(5, 10)

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
