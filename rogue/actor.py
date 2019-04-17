from __future__ import annotations
import dataclasses
import enum
from typing import List, Dict, Optional, Tuple

from .objects import Object, Equipment, BodyPart
from .actions import Action, MeleeAttackAction, MoveAction

@dataclasses.dataclass
class ActorState(enum.Enum):
    ALIVE = 1
    UNCONSCIOUS = 2
    DEAD = 3


@dataclasses.dataclass
class ActorAttributes(object):
    view_distance: int = 5
    strength: int = 5

    armor_class: int = 1
    health: int = 50
    hit_points: int = health
    max_inventory: int = 20

    energy: int = 0
    energy_to_act: int = 10
    energy_recharge: int = 2


@dataclasses.dataclass
class ActorStats(object):
    born: float = 0
    kills: int = 0


@dataclasses.dataclass
class Actor(Object):
    anchored: bool = True
    blocks: bool = True

    inventory: List[Object] = dataclasses.field(default_factory=list)
    attributes: ActorAttributes = dataclasses.field(default_factory=ActorAttributes)
    stats: ActorStats = dataclasses.field(default_factory=ActorStats)
    equipment: Dict[BodyPart, Equipment] = dataclasses.field(default_factory=dict)

    target: Optional[Actor] = None
    path: Optional[List[Tuple[int, int]]] = None

    def get_action(self, world) -> Optional[Action]:
        if self.target:
            return MeleeAttackAction(target=self.target)

        if self.path:
            x, y = self.path.pop(0)
            dx, dy = x - self.x, y - self.y
            return MoveAction(dx, dy)

        return None

    def set_waypoint(self, world, waypoint):
        area = world.get_area(self)
        self.path = area.find_path(self, waypoint)

    @property
    def can_act(self):
        return self.attributes.energy >= self.attributes.energy_to_act

    def charge_energy(self):
        self.attributes.energy += self.attributes.energy_recharge

    def drain_energy(self):
        self.attributes.energy = 0

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
        if self.attributes.hit_points > 0:
            return ActorState.ALIVE
        elif self.attributes.hit_points <= 0 and abs(self.attributes.hit_points) < self.attributes.health:
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


@dataclasses.dataclass
class Player(Actor):
    """
    Base class for interactive actors
    """

    next_action: Optional[Action] = None

    def find_object_by_id(self, id_):
        return next((o for o in self.inventory if o.id == id_), None)

    def get_action(self, world):
        rv = super(Player, self).get_action(world)
        if not rv and self.next_action:
            rv = self.next_action
            self.next_action = None
        return rv
