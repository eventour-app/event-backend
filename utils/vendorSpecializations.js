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

// Fixed options for service locations (where vendors provide their services)
// Vendors can select multiple options for each service
const SERVICE_LOCATIONS = [
  'Terrace',
  'Car boot',
  'Living room',
  'Cabinet',
  'Lawn',
  'Backyard',
  'Apartment',
];

// Fixed options for Pandit specializations
const PANDIT_LANGUAGES = [
  'Hindi',
  'Tamil',
  'Telugu',
  'Kannada',
  'Marathi',
  'Malayalam',
  'Odiya',
  'Sanskrit',
  'English',
];

// Pandit service categories and their sub-options
// Based on https://www.harivara.com/catalogue/
const PANDIT_SERVICES = {
  'Ceremonies': [
    { name: 'Hindu Wedding', defaultHours: 4, defaultPrice: '' },
    { name: 'Engagement Ceremony', defaultHours: 2, defaultPrice: '' },
    { name: 'Mehndi Ceremony', defaultHours: 2, defaultPrice: '' },
    { name: 'Sangeet Ceremony', defaultHours: 2, defaultPrice: '' },
    { name: 'Haldi Ceremony', defaultHours: 1, defaultPrice: '' },
    { name: 'Reception Ceremony', defaultHours: 2, defaultPrice: '' },
    { name: 'Griha Pravesh', defaultHours: 2, defaultPrice: '' },
    { name: 'Vastu Shanti', defaultHours: 3, defaultPrice: '' },
    { name: 'Satyanarayan Puja', defaultHours: 2, defaultPrice: '' },
    { name: 'Mundan Ceremony', defaultHours: 1, defaultPrice: '' },
    { name: 'Annaprashan', defaultHours: 1, defaultPrice: '' },
    { name: 'Namkaran', defaultHours: 1, defaultPrice: '' },
    { name: 'Upanayanam', defaultHours: 3, defaultPrice: '' },
  ],
  'Homam': [
    { name: 'Ganapathi Homam', defaultHours: 2, defaultPrice: '' },
    { name: 'Navagraha Homam', defaultHours: 3, defaultPrice: '' },
    { name: 'Sudarshana Homam', defaultHours: 2, defaultPrice: '' },
    { name: 'Maha Mrityunjaya Homam', defaultHours: 3, defaultPrice: '' },
    { name: 'Lakshmi Kubera Homam', defaultHours: 2, defaultPrice: '' },
    { name: 'Chandi Homam', defaultHours: 4, defaultPrice: '' },
    { name: 'Rudra Homam', defaultHours: 3, defaultPrice: '' },
    { name: 'Ayush Homam', defaultHours: 2, defaultPrice: '' },
    { name: 'Dhanvantari Homam', defaultHours: 2, defaultPrice: '' },
    { name: 'Vastu Homam', defaultHours: 2, defaultPrice: '' },
  ],
  'Pariharam': [
    { name: 'Kala Sarpa Dosha Nivaran', defaultHours: 3, defaultPrice: '' },
    { name: 'Mangal Dosha Shanti', defaultHours: 2, defaultPrice: '' },
    { name: 'Pitru Dosha Nivaran', defaultHours: 2, defaultPrice: '' },
    { name: 'Rahu Ketu Shanti', defaultHours: 2, defaultPrice: '' },
    { name: 'Shani Dosha Nivaran', defaultHours: 2, defaultPrice: '' },
    { name: 'Navagraha Shanti', defaultHours: 3, defaultPrice: '' },
    { name: 'Vastu Dosha Nivaran', defaultHours: 2, defaultPrice: '' },
  ],
  'Poojas': [
    { name: 'Ganesh Puja', defaultHours: 1, defaultPrice: '' },
    { name: 'Lakshmi Puja', defaultHours: 1, defaultPrice: '' },
    { name: 'Durga Puja', defaultHours: 2, defaultPrice: '' },
    { name: 'Saraswati Puja', defaultHours: 1, defaultPrice: '' },
    { name: 'Shiva Puja', defaultHours: 1, defaultPrice: '' },
    { name: 'Vishnu Puja', defaultHours: 1, defaultPrice: '' },
    { name: 'Hanuman Puja', defaultHours: 1, defaultPrice: '' },
    { name: 'Navratri Puja', defaultHours: 2, defaultPrice: '' },
    { name: 'Akhand Ramayan Path', defaultHours: 24, defaultPrice: '' },
    { name: 'Sunderkand Path', defaultHours: 3, defaultPrice: '' },
  ],
  'Powerful Devi Homam': [
    { name: 'Lalitha Sahasranama Homam', defaultHours: 3, defaultPrice: '' },
    { name: 'Durga Saptashati Homam', defaultHours: 4, defaultPrice: '' },
    { name: 'Chamundi Homam', defaultHours: 3, defaultPrice: '' },
    { name: 'Bhuvaneshwari Homam', defaultHours: 3, defaultPrice: '' },
    { name: 'Tripura Sundari Homam', defaultHours: 3, defaultPrice: '' },
    { name: 'Katyayani Homam', defaultHours: 3, defaultPrice: '' },
  ],
  'Ancestor-Rituals': [
    { name: 'Shraddha', defaultHours: 2, defaultPrice: '' },
    { name: 'Tarpan', defaultHours: 1, defaultPrice: '' },
    { name: 'Pind Daan', defaultHours: 2, defaultPrice: '' },
    { name: 'Pitru Paksha Puja', defaultHours: 2, defaultPrice: '' },
    { name: 'Annual Shraddha', defaultHours: 2, defaultPrice: '' },
    { name: 'Asthi Visarjan', defaultHours: 1, defaultPrice: '' },
    { name: 'Narayan Bali', defaultHours: 3, defaultPrice: '' },
  ],
  'Festival Poojas Tamil': [
    { name: 'Pongal Puja', defaultHours: 1, defaultPrice: '' },
    { name: 'Tamil New Year Puja', defaultHours: 1, defaultPrice: '' },
    { name: 'Vinayaka Chaturthi', defaultHours: 2, defaultPrice: '' },
    { name: 'Navaratri Golu Puja', defaultHours: 1, defaultPrice: '' },
    { name: 'Karthigai Deepam', defaultHours: 1, defaultPrice: '' },
    { name: 'Aadi Perukku', defaultHours: 1, defaultPrice: '' },
    { name: 'Varalakshmi Vratam', defaultHours: 2, defaultPrice: '' },
  ],
  'Donations': [
    { name: 'Go Daan (Cow Donation)', defaultHours: 1, defaultPrice: '' },
    { name: 'Anna Daan (Food Donation)', defaultHours: 1, defaultPrice: '' },
    { name: 'Vastra Daan (Clothes Donation)', defaultHours: 1, defaultPrice: '' },
    { name: 'Kanyadaan Assistance', defaultHours: 2, defaultPrice: '' },
    { name: 'Brahmin Bhoj', defaultHours: 2, defaultPrice: '' },
  ],
  'Music for Pooja': [
    { name: 'Nadaswaram', defaultHours: 2, defaultPrice: '' },
    { name: 'Shehnai', defaultHours: 2, defaultPrice: '' },
    { name: 'Vedic Chanting', defaultHours: 1, defaultPrice: '' },
    { name: 'Bhajan Mandali', defaultHours: 2, defaultPrice: '' },
    { name: 'Kirtan', defaultHours: 2, defaultPrice: '' },
  ],
};

module.exports = { THEMES, EVENT_TYPES, SERVICE_LOCATIONS, PANDIT_LANGUAGES, PANDIT_SERVICES };