// Cortex 21-type taxonomy (12 concept, 7 entity, 2 relation)
export const TAXONOMY = {
  // Concepts → mind/
  idea: 'concept',
  opinion: 'concept',
  belief: 'concept',
  preference: 'concept',
  lesson: 'concept',
  decision: 'concept',
  commitment: 'concept',
  goal_short: 'concept',
  goal_long: 'concept',
  aspiration: 'concept',
  constraint: 'concept',

  // Entities → vault/
  fact: 'entity',
  document: 'entity',
  person: 'entity',
  milestone: 'entity',
  task: 'entity',
  event: 'entity',
  resource: 'entity',

  // Relations → vault/
  project: 'relation',
  dependency: 'relation',
};

export const VALID_TYPES = new Set(Object.keys(TAXONOMY));
export const CONCEPT_TYPES = new Set(Object.keys(TAXONOMY).filter(t => TAXONOMY[t] === 'concept'));
export const ENTITY_TYPES = new Set(Object.keys(TAXONOMY).filter(t => TAXONOMY[t] === 'entity'));
export const RELATION_TYPES = new Set(Object.keys(TAXONOMY).filter(t => TAXONOMY[t] === 'relation'));

export function getCategory(type) {
  return TAXONOMY[type] || null;
}

export function getDestination(type) {
  const cat = TAXONOMY[type];
  if (cat === 'concept') return 'mind';
  if (cat === 'entity' || cat === 'relation') return 'vault';
  return null;
}
