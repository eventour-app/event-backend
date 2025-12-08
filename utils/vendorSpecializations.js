// Fixed options for vendor specializations (themes and event types)
// These values are stable and served by backend to keep frontend in sync.

const THEMES = [
  'Traditional',
  'Modern',
  'Rustic / Boho',
  'Luxury / Premium',
  'Minimalistic',
  'Cultural',
  'Seasonal / Festive',
  'Kids / Cartoon',
  'Corporate / Formal',
];

const EVENT_TYPES = [
  'Wedding & Couple Events',
  'Birthdays & Age Milestones',
  'Baby, Newborn & Parenting Events',
  'Family Milestones & Personal Achievements',
  'Parties, Social & Theme Events',
  'Religious, Spiritual & Festival Events',
  'Memorial, Funeral & Condolence Events',
  'Corporate, Business & Professional Events',
  'Youth & Talent Events',
  'Entertainment, Performance & Live Events',
  'Sports, Fitness & Adventure Events',
  'Exhibitions, Fairs & Public Showcases',
  'Community, Society & Social Cause Events',
  'Government, Political & National Events',
];

module.exports = { THEMES, EVENT_TYPES };