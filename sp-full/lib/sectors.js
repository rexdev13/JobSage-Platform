// Name/route based sector classifier. First matching rule wins, so order matters.
const RULES = [
  ['recruitment', /\b(recruit\w*|staffing|resourc(?:e|ing)|personnel|talent|workforce|employment|locum\w*|headhunt\w*|manpower)\b/],
  ['healthcare', /\b(nhs|hospital\w*|health\w*|medical|clinic\w*|dental|dentist\w*|pharmac\w*|nursing|nurses|surgery|hospice|therap\w*|homecare|domiciliary|care|carers?|caring|residential|physio\w*|optic\w*|veterinar\w*|vets?|ambulance|mental)\b/],
  ['education', /\b(school\w*|academy|academies|college|university|universities|nursery|education\w*|tuition|learning|training|institute|montessori|tutor\w*)\b/],
  ['tech', /\b(software|tech\w*|digital|data|systems?|cyber\w*|cloud|computing|computers?|ai|labs?|analytics|networks?|it|web|apps?|robotics|semiconductor\w*|telecom\w*|online)\b/],
  ['finance_professional', /\b(bank\w*|capital|financ\w*|insurance|invest\w*|wealth|asset\w*|audit\w*|accountan\w*|account\w*|consult\w*|advis\w*|legal|law|solicitors?|llp|partners|partnership|mortgage\w*|payments?|fund\w*|actuar\w*|tax)\b/],
  ['engineering_construction', /\b(engineer\w*|construction|building|builders?|civil|contractors?|electrical|mechanical|architect\w*|surveyor\w*|infrastructure|energy|power|renewables?|solar|manufactur\w*|fabricat\w*|plumb\w*|heating|joinery|scaffold\w*|aerospace|automotive|motors?)\b/],
  ['hospitality_food', /\b(restaurants?|hotels?|cafe|caf[eé]s?|kitchens?|food\w*|bars?|pubs?|catering|bakery|takeaway|pizz\w*|grill|curry|tandoori|kebab|fish|chicken|hospitality|inn|lodge|dining|brasserie|bistro|coffee|spice|thai|indian|chinese|noodle\w*)\b/],
  ['retail_wholesale', /\b(retail\w*|stores?|shops?|supermarkets?|marts?|wholesale\w*|trading|fashion|boutique|e-?commerce|supplies|supplier\w*|distribut\w*|importers?|exporters?)\b/],
  ['logistics_transport', /\b(logistics|transport\w*|freight|haulage|delivery|couriers?|shipping|cargo|taxi|cabs?|travel|aviation|airlines?|airways|rail\w*|bus|coaches|fleet|warehous\w*)\b/],
  ['charity_public', /\b(charity|charitable|trust|foundation|council|church|churches|association|society|mosque|temple|community|housing|federation)\b/],
  ['media_creative', /\b(media|design\w*|creative|studios?|marketing|advertis\w*|film\w*|production\w*|publishing|publishers?|entertainment|games?|gaming|music|sport\w*|fitness|gym)\b/],
];

const ROUTE_HINTS = [
  [/health and care/i, 'healthcare'],
  [/scale-?up/i, 'tech'],
];

function classify(name, routes = '') {
  const n = ' ' + String(name).toLowerCase().replace(/[^a-z0-9\s&-]/g, ' ') + ' ';
  for (const [sector, re] of RULES) if (re.test(n)) return sector;
  for (const [re, sector] of ROUTE_HINTS) if (re.test(routes)) return sector;
  return 'other';
}

const SECTORS = [...RULES.map((r) => r[0]), 'other'];

module.exports = { classify, SECTORS };
