import abc
import random

from .tiles import Door
from .objects import Item, Equipment, BodyPart, Weapon, Shield, Bones, Sign, Box
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
        area = world.get_area(actor)

        x = actor.x + self.dx
        y = actor.y + self.dy
        if x < 0 or x >= area.map_width or y < 0 or y >= area.map_height:
            return False

        tile = area.get_tile(x, y)
        if tile.blocked or any(obj.blocks for obj in area.get_objects(x, y)):
            return False
        area.move_object(actor, x, y)
        area.broadcast(actor)
        return True


class EnterAction(Action):
    NAME = "enter"

    def perform(self, actor, world):
        area = world.get_area(actor)
        pt = area.get_tile(actor.x, actor.y)
        if isinstance(pt, Door):
            new_area, position = pt.get_area(world, area, (actor.x, actor.y))
            area.add_area(new_area)
            world.add_actor(actor, area=new_area)
            x, y = position
            area.remove_object(actor)
            new_area.add_object(actor, x, y)
            actor.notice("you have entered {}".format(pt), mood=True, entered=new_area.id)
            actor.waypoint = None
            new_area.broadcast(actor)


class ReadAction(Action):
    NAME = "read"

    def __init__(self, target):
        self.target = target

    def perform(self, actor, world):
        actor.notice("The sign says: " + self.target.message, popup=True)


class OpenAction(Action):
    NAME = "open"

    def __init__(self, target):
        self.target = target

    def perform(self, actor, world):
        area = world.get_area(actor)
        self.target.open(actor, area)


class EquipAction(Action):
    NAME = "equip"

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

            if obj in actor.inventory:
                actor.notice("you are already holding {}".format(obj))
            elif actor.has_inventory_space:
                actor.inventory.append(obj)
                actor.notice("you picked up a {}".format(obj))
            else:
                actor.notice("you cannot pickup {}".format(obj))
        area.broadcast(actor)


class DropItemAction(Action):
    NAME = "drop"

    def __init__(self, obj):
        self.obj = obj

    def perform(self, actor, world):
        if self.obj in actor.inventory:
            actor.inventory.remove(self.obj)
            self.obj.x = actor.x
            self.obj.y = actor.y
            area = world.get_area(actor)
            area.broadcast(actor)


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
            actor.notice("{} missed {}".format(actor.name, self.target.name))
            return

        damage = actor.attributes.strength + (random.randint(1, actor.weapon.damage) if actor.has_weapon else 0)

        critical = attack_roll >= 19
        if not critical:
            damage -= self.target.attributes.armor_class

        if self.target.has_shield:
            damage -= self.target.shield.damage

        if damage <= 0:
            actor.notice("{} did no damage to {}", actor.name, self.target.name)
            return

        self.target.attributes.hit_points -= damage
        self.target.hurt(actor, damage)

        if critical:
            actor.notice("critical hit by {} on {} for {} damage!!!".format(actor.name, self.target.name, damage))
        else:
            actor.notice("hit by {} on {} for {} damage!".format(actor.name, self.target.name, damage))

        if self.target.attributes.hit_points <= 0:
            self.target.die()
            area = world.get_area(self.target)
            bones = Bones(name="bones of " + self.target.name)
            area.add_object(bones, self.target.x, self.target.y)

            pos = area.immediate_area(self.target)
            while self.target.inventory:
                obj = self.target.inventory.pop()
                for _ in range(10):
                    x, y = random.choice(pos)
                    if area.is_tile_free(x, y):
                        area.add_object(obj, x, y)
                        break

            actor.stats.kills += 1
            actor.attributes.experience += self.target.attributes.experience
            actor.notice("{} killed a {}".format(actor.name, self.target.name))
            world.remove_actor(self.target)

            from .npcs import NPC, Skeleton

            def _revive():
                area.remove_object(bones)
                skeleton = Skeleton(name="skeleton")
                world.add_actor(skeleton, area)
                area.move_object(skeleton, bones.x, bones.y)

            if issubclass(type(self.target), NPC) and not isinstance(self.target, Skeleton):
                world.schedule(100, _revive)
            area.broadcast(actor)
