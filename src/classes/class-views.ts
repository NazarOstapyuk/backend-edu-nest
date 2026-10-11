import { Prisma } from '@prisma/client';

export const personSelect = {
  select: { id: true, firstName: true, lastName: true },
} as const;
export const tariffRefSelect = { select: { id: true, name: true } } as const;

const isActiveMember = (
  m: { startDate: Date; endDate: Date | null },
  today: Date,
) =>
  m.startDate.getTime() <= today.getTime() &&
  (m.endDate === null || m.endDate.getTime() >= today.getTime());

export const groupSummaryInclude = {
  teachers: personSelect,
  singleTariff: tariffRefSelect,
  packageTariff: tariffRefSelect,
  members: { select: { startDate: true, endDate: true } },
} satisfies Prisma.ClassGroupInclude;

export const directionInclude = {
  groups: { include: groupSummaryInclude, orderBy: { name: 'asc' } },
} satisfies Prisma.DirectionInclude;

export const groupDetailInclude = {
  direction: { select: { id: true, name: true, missedRule: true } },
  teachers: personSelect,
  singleTariff: tariffRefSelect,
  packageTariff: tariffRefSelect,
  members: { include: { child: personSelect }, orderBy: { startDate: 'asc' } },
  lessons: {
    orderBy: { date: 'desc' },
    take: 50,
    include: {
      conductedBy: personSelect,
      attendances: {
        where: { voidedAt: null },
        include: { child: personSelect },
      },
    },
  },
} satisfies Prisma.ClassGroupInclude;

type SummaryGroup = Prisma.ClassGroupGetPayload<{
  include: typeof groupSummaryInclude;
}>;
type DirectionWithGroups = Prisma.DirectionGetPayload<{
  include: typeof directionInclude;
}>;
export type DetailGroup = Prisma.ClassGroupGetPayload<{
  include: typeof groupDetailInclude;
}>;

export const toGroupSummary = (g: SummaryGroup | DetailGroup, today: Date) => ({
  id: g.id,
  name: g.name,
  format: g.format,
  isActive: g.isActive,
  teachers: g.teachers,
  singleTariff: g.singleTariff,
  packageTariff: g.packageTariff,
  activeMembers: g.members.filter((m) => isActiveMember(m, today)).length,
});

export const toDirectionView = (d: DirectionWithGroups, today: Date) => ({
  id: d.id,
  name: d.name,
  missedRule: d.missedRule,
  isActive: d.isActive,
  groups: d.groups.map((g) => toGroupSummary(g, today)),
});

export const toGroupDetail = (g: DetailGroup, today: Date) => ({
  ...toGroupSummary(g, today),
  direction: g.direction,
  members: g.members.map((m) => ({
    id: m.id,
    child: m.child,
    startDate: m.startDate,
    endDate: m.endDate,
  })),
  lessons: g.lessons.map((l) => ({
    id: l.id,
    date: l.date,
    conductedBy: l.conductedBy,
    attendances: l.attendances.map((a) => ({
      childId: a.childId,
      childName: `${a.child.lastName} ${a.child.firstName}`,
      status: a.status,
      isGuest: a.isGuest,
    })),
  })),
});
