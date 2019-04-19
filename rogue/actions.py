import abc
import random

from .tiles import Door
from .objects import Item, Equipment, BodyPart, Weapon, Shield
from .util import project_enum

ACTIONS = {}


class ActionError(Exception):
    pass


class Action(object, metaclass=abc.ABCMeta):
    NAME = None
    ENERGY = 1

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        ACTIONS[cls.NAME] = cls

    @abc.abstractmethod
    def perform(self, actor, world):
        pass


class MoveAction(Action):
    NAME = "move"

    def __init__(self, dx, dy):
        super(MoveAction, self).__init__()
        self.dx = dx
        self.dy = dy

    def perform(self, actor, world):
        x = actor.x + self.dx
        y = actor.y + self.dy
        area = world.get_area(actor)

        if x < 0 or x >= area.map_width or y < 0 or y >= area.map_height:
            return False

        tile = area.get_tile(x, y)
        if tile.blocked or any(obj.blocks for obj in area.get_objects(x, y)):
            return False

        actor.x = x
        actor.y = y

        return True


class EnterAction(Action):
    NAME = "enter"

    def perform(self, actor, world):
        area = world.get_area(actor)
        pt = area.get_tile(actor.x, actor.y)
        if isinstance(pt, Door):
            new_area, position = pt.get_area(world, area, (actor.x, actor.y))
            world.add_actor(actor, area=new_area)
            x, y = position
            new_area.add_object(actor, x, y)
            area.remove_object(actor)
            actor.notice("you have entered {}".format(pt), mood=True)


class EquipAction(Action):
    def __init__(self, obj):
        if not isinstance(obj, Equipment):
            raise ActionError("cannot equip this")
        self.obj = obj
        if isinstance(self.obj, Weapon):
            self.part = BodyPart.RIGHT_HAND
        elif isinstance(self.obj, Shield):
            self.part = BodyPart.LEFT_HAND

    def perform(self, actor, world):
        actor.equipment[self.part] = self.obj
        actor.notice("you equipped a {} to your {}".format(self.obj, project_enum(self.part)))


class PickupItemAction(Action):
    NAME = "pickup"

    def perform(self, actor, world):
        area = world.get_area(actor)
        objs = [obj for obj in area.get_objects(actor.x, actor.y) if not (obj is actor or obj.anchored)]

        for obj in objs:
            area.remove_object(obj)

            if obj not in actor.inventory and len(actor.inventory) < actor.attributes.max_inventory:
                actor.inventory.append(obj)
                actor.notice("you picked up a {}".format(obj))


class DropItemAction(Action):
    NAME = "drop"

    def __init__(self, obj):
        self.obj = obj

    def perform(self, actor, world):
        if self.obj in actor.inventory:
            actor.inventory.remove(self.obj)
            self.obj.x = actor.x
            self.obj.y = actor.y


class UseItemAction(Action):
    NAME = "use"

    def __init__(self, obj):
        self.obj = obj
        if not isinstance(self.obj, Item):
            raise ActionError("cannot use this")

    def perform(self, actor, world):
        self.obj.use(actor)
        actor.inventory.remove(self.obj)


class MeleeAttackAction(Action):
    NAME = "melee"

    def __init__(self, target=None):
        self.target = target

    def perform(self, actor, world):
        if not self.target:
            targets = world.surrounding_actors(actor)
            if targets:
                self.target = targets[0]

        if not self.target:
            return

        attack_roll = random.randint(1, 20)
        if attack_roll <= 1:
            actor.notice("you missed {}".format(self.target.name))
            return

        damage = actor.attributes.strength + (random.randint(1, actor.weapon.damage) if actor.has_weapon else 0)

        critical = attack_roll >= 19
        if not critical:
            damage -= self.target.attributes.armor_class

        if self.target.has_shield:
            damage -= self.target.shield.damage

        if damage <= 0:
            actor.notice("you did no damage")
            return

        self.target.attributes.hit_points -= damage
        self.target.hurt(actor, damage)

        if critical:
            actor.notice("critical hit on {} for {} damage!!!".format(self.target.name, damage))
        else:
            actor.notice("hit on {} for {} damage!".format(self.target.name, damage))

        if self.target.attributes.hit_points <= 0:
            self.target.die()
            world.remove_actor(self.target)
            actor.stats.kills += 1
            actor.notice("you killed a {}".format(self.target.name))
