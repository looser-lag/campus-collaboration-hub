
import { storage, nextId } from './store.js'
import { notify, notifyAll, nameOf } from './notify.js'
import { ok, fail, failFields, clean, toInt, splitList, isDate, localToday, isoNow, checkLinks } from './util.js'

export const CATEGORIES = ['Robotics', 'Software', 'Hardware', 'AI/ML', 'Research', 'Campus improvement', 'Competition', 'Other']
export const EXPERIENCE = ['beginner-friendly', 'mixed-level', 'skills required']
export const RECRUITING = ['open', 'forming']
export const ACTIVE_APP = ['pending', 'accepted']
export const TASK_LABEL = { not_started: 'Not started', in_progress: 'In progress', submitted: 'Submitted', completed: 'Completed' }

// Allowed lifecycle moves. Anything not listed here is refused.
export const FLOW = {
  open: ['forming', 'active', 'archived'],
  forming: ['active', 'archived'],
  active: ['completed'],
  completed: ['archived'],
  archived: []
}

const all = (c) => storage.get(c)
const one = (c, id) => all(c).find((r) => r.id === id)

// ---- Lookups used by the pages -------------------------------------------
export const rolesOf = (oppId) => all('roles').filter((r) => r.opportunityId === oppId)
export const appsOf = (oppId) => all('applications').filter((a) => a.opportunityId === oppId)
export const filled = (roleId) => all('applications').filter((a) => a.roleId === roleId && a.status === 'accepted').length
export const openingsLeft = (oppId) => rolesOf(oppId).reduce((n, r) => n + Math.max(0, r.openings - filled(r.id)), 0)
export const teamIds = (opp) => [
  ...new Set([opp.creatorId, ...appsOf(opp.id).filter((a) => a.status === 'accepted').map((a) => a.applicantId)])
]

// ---- Opportunities --------------------------------------------------------
function checkOpportunity(f, existing) {
  const e = {}
  const v = {
    title: clean(f.title),
    description: clean(f.description),
    expectedOutcome: clean(f.expectedOutcome),
    nextStep: clean(f.nextStep),
    category: f.category,
    experience: f.experience,
    durationDays: toInt(f.durationDays),
    weeklyHours: toInt(f.weeklyHours),
    deadline: clean(f.deadline)
  }
  if (v.title.length < 5 || v.title.length > 100) e.title = 'Give the project a title of 5 to 100 characters.'
  if (v.description.length < 20 || v.description.length > 1500) e.description = 'Describe the goal in 20 to 1500 characters.'
  if (v.expectedOutcome.length < 5 || v.expectedOutcome.length > 300) e.expectedOutcome = 'Say what the group will have produced at the end (5 to 300 characters).'
  if (v.nextStep.length < 5 || v.nextStep.length > 200) e.nextStep = 'Say how the group will start, such as the first meeting or first task (5 to 200 characters).'
  if (!CATEGORIES.includes(v.category)) e.category = 'Choose a category.'
  if (!EXPERIENCE.includes(v.experience)) e.experience = 'Choose the experience level you expect.'
  if (!(v.durationDays >= 1 && v.durationDays <= 365)) e.durationDays = 'Duration must be a whole number from 1 to 365 days.'
  if (!(v.weeklyHours >= 1 && v.weeklyHours <= 40)) e.weeklyHours = 'Weekly hours must be a whole number from 1 to 40.'
  if (v.deadline) {
    if (!isDate(v.deadline)) e.deadline = 'Enter a valid date.'
    else if (v.deadline < localToday() && v.deadline !== existing?.deadline) e.deadline = 'The deadline cannot be in the past.'
  }
  return { errors: e, value: v }
}

function checkRole(f) {
  const e = {}
  const v = {
    title: clean(f.roleTitle),
    openings: toInt(f.openings),
    requiredSkills: splitList(f.requiredSkills),
    preferredSkills: splitList(f.preferredSkills),
    beginnerFriendly: !!f.beginnerFriendly,
    deliverable: clean(f.deliverable),
    learningResources: splitList(f.learningResources)
  }
  if (v.title.length < 2 || v.title.length > 60) e.roleTitle = 'Give the role a title of 2 to 60 characters.'
  if (!(v.openings >= 1 && v.openings <= 10)) e.openings = 'Openings must be a whole number from 1 to 10.'
  if (v.deliverable.length < 5 || v.deliverable.length > 200) e.deliverable = 'Describe what this person will deliver (5 to 200 characters).'
  checkLinks(v.learningResources, e, 'learningResources')
  return { errors: e, value: v }
}

function insertRole(oppId, v) {
  storage.insert('roles', { id: nextId('role', 'roles'), opportunityId: oppId, ...v })
}

export function createOpportunity(userId, f, roleF) {
  const a = checkOpportunity(f)
  const b = checkRole(roleF)
  const errors = { ...a.errors, ...b.errors }
  if (Object.keys(errors).length) return failFields(errors)
  const source = f.sourcePostId ? one('posts', f.sourcePostId) : null
  const id = nextId('opp', 'opportunities')
  storage.insert('opportunities', {
    id, creatorId: userId, type: 'project', ...a.value,
    status: 'open', createdAt: isoNow(), archivedAt: null, completedAt: null, outcomeSummary: '', sourcePostId: source?.id || null
  })
  insertRole(id, b.value)
  if (source && source.authorId !== userId) {
    notify(source.authorId, 'bridge', `${nameOf(userId)} turned your post "${source.title}" into a project.`, `projects/${id}`)
  }
  return ok({ id })
}

export function updateOpportunity(oppId, userId, f) {
  const opp = one('opportunities', oppId)
  if (!opp) return fail('That project no longer exists.')
  if (opp.creatorId !== userId) return fail('Only the project owner can edit it.')
  if (!['open', 'forming', 'active'].includes(opp.status)) return fail('Completed or archived projects cannot be edited.')
  const { errors, value } = checkOpportunity(f, opp)
  if (Object.keys(errors).length) return failFields(errors)
  storage.update('opportunities', oppId, value)
  return ok()
}

export function addRole(oppId, userId, f) {
  const opp = one('opportunities', oppId)
  if (!opp) return fail('That project no longer exists.')
  if (opp.creatorId !== userId) return fail('Only the project owner can add roles.')
  if (!RECRUITING.includes(opp.status)) return fail('Roles can only be added while the project is recruiting.')
  const { errors, value } = checkRole(f)
  if (Object.keys(errors).length) return failFields(errors)
  insertRole(oppId, value)
  return ok()
}

export function removeRole(roleId, userId) {
  const role = one('roles', roleId)
  if (!role) return fail('That role no longer exists.')
  const opp = one('opportunities', role.opportunityId)
  if (opp.creatorId !== userId) return fail('Only the project owner can remove roles.')
  if (all('applications').some((a) => a.roleId === roleId && ACTIVE_APP.includes(a.status)))
    return fail('This role has pending or accepted applicants. Answer or release them first.')
  if (RECRUITING.includes(opp.status) && rolesOf(opp.id).length <= 1) return fail('A recruiting project needs at least one role.')
  storage.save('applications', all('applications').filter((a) => a.roleId !== roleId))
  storage.remove('roles', roleId)
  return ok()
}

export function transitionOpportunity(oppId, userId, to, summary = '') {
  const opp = one('opportunities', oppId)
  if (!opp) return fail('That project no longer exists.')
  if (opp.creatorId !== userId) return fail('Only the project owner can change the project status.')
  if (!FLOW[opp.status].includes(to)) return fail(`A ${opp.status} project cannot move to ${to}.`)
  if (to === 'active' && teamIds(opp).length < 2) return fail('Accept at least one applicant before closing recruitment.')
  const patch = { status: to }
  if (to === 'completed') {
    if (clean(summary).length < 10) return failFields({ summary: 'Write a short outcome summary (at least 10 characters).' })
    patch.completedAt = isoNow()
    patch.outcomeSummary = clean(summary)
  }
  if (to === 'archived') patch.archivedAt = isoNow()
  const waiting = appsOf(oppId).filter((a) => a.status === 'pending')
  if (to === 'active' || to === 'archived') {
    // Recruitment is over, so anyone still waiting gets a clear answer.
    storage.save('applications', all('applications').map((a) =>
      a.opportunityId === oppId && a.status === 'pending' ? { ...a, status: 'declined' } : a))
  }
  storage.update('opportunities', oppId, patch)
  const link = `projects/${oppId}`
  const msg = { active: `${opp.title} is now under way.`, completed: `${opp.title} was completed.`, archived: `${opp.title} was archived.` }
  if (msg[to]) notifyAll(teamIds(opp), 'project', msg[to], link, userId)
  if (to === 'active' || to === 'archived') {
    waiting.forEach((a) => notify(a.applicantId, 'application', `${opp.title} closed recruitment, so your application was not taken forward.`, link))
  }
  return ok()
}

// Projects that never formed a team and whose deadline has passed are archived,
// so old opportunities do not look active forever.
export function expireOpportunities(today = localToday()) {
  const stale = all('opportunities').filter((o) => o.status === 'open' && o.deadline && o.deadline < today)
  stale.forEach((o) => {
    const waiting = appsOf(o.id).filter((a) => a.status === 'pending')
    storage.save('applications', all('applications').map((a) => (a.opportunityId === o.id && a.status === 'pending' ? { ...a, status: 'declined' } : a)))
    storage.update('opportunities', o.id, {
      status: 'archived', archivedAt: isoNow(), outcomeSummary: 'Archived automatically: the deadline passed before a team formed.'
    })
    notify(o.creatorId, 'project', `${o.title} was archived because its deadline passed before a team formed.`, `projects/${o.id}`)
    waiting.forEach((a) => notify(a.applicantId, 'application', `${o.title} was archived, so your application was not taken forward.`, `projects/${o.id}`))
  })
  return stale.length
}

// ---- Applications ---------------------------------------------------------
export function applyToRole(userId, roleId, f) {
  const role = one('roles', roleId)
  if (!role) return fail('That role no longer exists.')
  const opp = one('opportunities', role.opportunityId)
  if (!RECRUITING.includes(opp.status)) return fail('This project is no longer recruiting.')
  if (opp.creatorId === userId) return fail('You cannot apply to your own project.')
  if (all('applications').some((a) => a.roleId === roleId && a.applicantId === userId && ACTIVE_APP.includes(a.status)))
    return fail('You already have an active application for this role.')
  if (filled(roleId) >= role.openings) return fail('This role is already full.')

  const e = {}
  const v = {
    message: clean(f.message),
    knownSkills: splitList(f.knownSkills),
    skillsToLearn: splitList(f.skillsToLearn),
    weeklyHours: toInt(f.weeklyHours)
  }
  if (v.message.length < 10 || v.message.length > 500) e.message = 'Tell the owner what you can contribute (10 to 500 characters).'
  if (!(v.weeklyHours >= 1 && v.weeklyHours <= 40)) e.weeklyHours = 'Weekly hours must be a whole number from 1 to 40.'
  if (Object.keys(e).length) return failFields(e)

  storage.insert('applications', {
    id: nextId('app', 'applications'), opportunityId: opp.id, roleId, applicantId: userId, ...v,
    status: 'pending', createdAt: isoNow()
  })
  notify(opp.creatorId, 'application', `${nameOf(userId)} applied for "${role.title}" in ${opp.title}.`, `projects/${opp.id}`)
  return ok()
}

export function respondToApplication(appId, userId, decision) {
  const app = one('applications', appId)
  if (!app) return fail('That application no longer exists.')
  const opp = one('opportunities', app.opportunityId)
  if (opp.creatorId !== userId) return fail('Only the project owner can answer applications.')
  if (app.status !== 'pending') return fail('This application has already been answered.')
  if (!RECRUITING.includes(opp.status)) return fail('Recruitment is closed, so applications can no longer be answered.')
  if (decision === 'accepted') {
    const role = one('roles', app.roleId)
    if (!role || filled(role.id) >= role.openings) return fail('That role is already full.')
  } else if (decision !== 'declined') {
    return fail('Unknown decision.')
  }
  storage.update('applications', appId, { status: decision })
  notify(app.applicantId, 'application', decision === 'accepted'
    ? `You were accepted into ${opp.title}.` : `Your application to ${opp.title} was declined.`, `projects/${opp.id}`)
  if (decision === 'accepted' && opp.status === 'open') storage.update('opportunities', opp.id, { status: 'forming' })
  return ok()
}

export function withdrawApplication(appId, userId) {
  const app = one('applications', appId)
  if (!app) return fail('That application no longer exists.')
  if (app.applicantId !== userId) return fail('You can only withdraw your own application.')
  if (!ACTIVE_APP.includes(app.status)) return fail('This application is not active.')
  const opp = one('opportunities', app.opportunityId)
  if (['completed', 'archived'].includes(opp.status)) return fail('Finished projects keep their team record.')
  storage.update('applications', appId, { status: 'withdrawn' })
  if (app.status === 'accepted') notify(opp.creatorId, 'application', `${nameOf(userId)} left ${opp.title}. Their tasks are unassigned.`, `projects/${opp.id}`)
  if (!teamIds(opp).includes(userId)) {
    // Work that was handed to this person goes back to "unassigned".
    storage.save('tasks', all('tasks').map((t) =>
      t.opportunityId === opp.id && t.assigneeId === userId && t.status !== 'completed' ? { ...t, assigneeId: null, status: 'not_started' } : t))
  }
  if (opp.status === 'forming' && teamIds(opp).length < 2) storage.update('opportunities', opp.id, { status: 'open' })
  return ok()
}

// ---- Tasks ----------------------------------------------------------------
export function createTask(oppId, userId, f) {
  const opp = one('opportunities', oppId)
  if (!opp) return fail('That project no longer exists.')
  if (opp.creatorId !== userId) return fail('Only the project owner can add tasks.')
  if (!['forming', 'active'].includes(opp.status)) return fail('Tasks can be added while the project is forming or active.')
  const e = {}
  const v = {
    title: clean(f.title),
    description: clean(f.description),
    assigneeId: f.assigneeId,
    dueDate: clean(f.dueDate),
    learningResources: splitList(f.learningResources)
  }
  if (v.title.length < 3 || v.title.length > 100) e.title = 'Give the task a title of 3 to 100 characters.'
  if (v.description.length > 500) e.description = 'Keep the description under 500 characters.'
  if (!teamIds(opp).includes(v.assigneeId)) e.assigneeId = 'Assign the task to a team member.'
  if (!isDate(v.dueDate)) e.dueDate = 'Enter a due date.'
  else if (v.dueDate < localToday()) e.dueDate = 'The due date cannot be in the past.'
  checkLinks(v.learningResources, e, 'learningResources')
  if (Object.keys(e).length) return failFields(e)
  storage.insert('tasks', { id: nextId('task', 'tasks'), opportunityId: oppId, ...v, status: 'not_started', reviewNote: '' })
  if (v.assigneeId !== userId) notify(v.assigneeId, 'task', `New task in ${opp.title}: ${v.title}`, `projects/${oppId}`)
  return ok()
}

export function updateTaskStatus(taskId, userId, to, note = '') {
  const task = one('tasks', taskId)
  if (!task) return fail('That task no longer exists.')
  const opp = one('opportunities', task.opportunityId)
  if (!['forming', 'active'].includes(opp.status)) return fail('Tasks are locked once a project is completed or archived.')
  const from = task.status
  const asAssignee = task.assigneeId === userId &&
    ((from === 'not_started' && to === 'in_progress') || (from === 'in_progress' && to === 'submitted'))
  const asOwner = opp.creatorId === userId && from === 'submitted' && (to === 'completed' || to === 'in_progress')
  if (!asAssignee && !asOwner) return fail('You cannot make that change to this task.')
  if (from === 'submitted' && to === 'in_progress' && clean(note).length < 3)
    return failFields({ note: 'Say what needs to change (at least 3 characters).' })
  storage.update('tasks', taskId, { status: to, reviewNote: from === 'submitted' ? clean(note) : task.reviewNote })
  const link = `projects/${opp.id}`
  if (to === 'submitted') notify(opp.creatorId, 'task', `${nameOf(userId)} submitted "${task.title}" for review.`, link)
  if (from === 'submitted' && to === 'completed') notify(task.assigneeId, 'task', `"${task.title}" was accepted.`, link)
  if (from === 'submitted' && to === 'in_progress') notify(task.assigneeId, 'task', `Changes requested on "${task.title}": ${clean(note)}`, link)
  return ok()
}

export function deleteTask(taskId, userId) {
  const task = one('tasks', taskId)
  if (!task) return fail('That task no longer exists.')
  const opp = one('opportunities', task.opportunityId)
  if (opp.creatorId !== userId) return fail('Only the project owner can delete tasks.')
  if (!['forming', 'active'].includes(opp.status)) return fail('Tasks are locked once a project is completed or archived.')
  storage.remove('tasks', taskId)
  return ok()
}
