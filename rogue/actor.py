from __future__ import annotations
import dataclasses
import enum
from typing import List, Dict, Optional, Tuple

from .objects import Object, Equipment, BodyPart
from .actions import Action, MeleeAttackAction, MoveAction, PickupItemAction, EnterAction
from .tiles import Door
from .annotations import NodeType


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

    max_energy: int = 20
    energy: int = max_energy
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
    waypoint: Optional[NodeType] = None

    fov: List[Tuple[int, int]] = dataclasses.field(default_factory=list)

    def get_action(self, world) -> Optional[Action]:
        if self.target:
            action = MeleeAttackAction(target=self.target)
            self.target = None
            return action

        area = world.get_area(self)

        if self.waypoint:
            if self.pos == self.waypoint:
                objs = [obj for obj in area.get_objects(self.x, self.y) if obj is not self]
                if objs:
                    return PickupItemAction()
                tile = area.get_tile(self.x, self.y)
                if tile and isinstance(tile, Door):
                    return EnterAction()
                self.waypoint = None
            else:
                path = area.find_path(self, self.waypoint)
                if path:
                    x, y = path.pop(0)
                    dx, dy = x - self.x, y - self.y
                    return MoveAction(dx, dy)

        return None

    def get_alternate_action(self, failed_action: Action) -> Optional[Action]:
        pass

    def set_waypoint(self, waypoint: NodeType):
        self.waypoint = waypoint

    @property
    def can_act(self):
        return self.attributes.energy >= self.attributes.energy_to_act

    def charge_energy(self):
        self.attributes.energy = min(self.attributes.energy + self.attributes.energy_recharge, self.attributes.max_energy)

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
        if self.next_action:
            rv = self.next_action
            self.next_action = None
        else:
            rv = super(Player, self).get_action(world)
        return rv
