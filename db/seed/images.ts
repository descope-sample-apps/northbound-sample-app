/**
 * Pinned Unsplash photo IDs, one per SKU, keyed by product slug.
 *
 * `source.unsplash.com` — the random-image endpoint — was retired and now
 * returns 503, so it cannot be used. These IDs address the images.unsplash.com
 * CDN directly, which serves a known photo with no API key and no rate limit.
 *
 * `pnpm images:fetch` downloads each one, converts it to WebP at 800x600, and
 * writes it to public/products/. Those files are COMMITTED, so a cold clone
 * demos correctly with no network access — which matters when the demo is
 * happening on a conference wifi.
 *
 * Attribution for every photo is recorded in public/products/CREDITS.md.
 */
export const PHOTO_IDS: Record<string, string> = {
  // Outerwear
  'ridgeline-3l-hardshell': 'photo-1516648064-ee10acfa64db',
  'tundra-800-down-parka': 'photo-1557479613-9f88c8450c5d',
  'coastal-rain-shell': 'photo-1613322800337-581785ea9f33',
  'brushline-grid-fleece': 'photo-1610623822276-8f66666ba681',
  'stormpeak-insulated-jacket': 'photo-1624548140150-108c3287f551',
  'driftwood-shirt-jacket': 'photo-1624548140129-74786c5f1279',
  'alpenglow-windbreaker': 'photo-1667841027705-40d21bd2b0ba',
  'glacier-softshell': 'photo-1667841027778-310023bd4120',

  // Footwear
  'summit-gtx-hiking-boot': 'photo-1530792271526-7ddf516473b3',
  'switchback-trail-runner': 'photo-1575987116913-e96e7d490b8a',
  'granite-mid-hiker': 'photo-1631287381310-925554130169',
  'basecamp-insulated-bootie': 'photo-1663000126027-489944d0086b',
  'talus-approach-shoe': 'photo-1517519610343-021766b185c1',
  'wanderer-leather-boot': 'photo-1600100315760-ac46b65f6fdd',
  'creekbed-water-shoe': 'photo-1655976795374-6b519928f1e1',
  'longtrail-gtx-low': 'photo-1617179395455-101d786b4b7d',

  // Packs & Bags
  'cascade-45l-expedition-pack': 'photo-1551632811-561732d1e306',
  'daybreak-22l-daypack': 'photo-1501555088652-021faa106b9b',
  'haulline-70l-expedition-pack': 'photo-1586022045497-31fcf76fa6cc',
  'spire-18l-summit-pack': 'photo-1476979735039-2fdea9e9e407',
  'portage-60l-duffel': 'photo-1509762774605-f07235a08f1f',
  'riverrun-20l-dry-bag': 'photo-1622260614153-03223fb72052',
  'trailhead-hip-pack': 'photo-1622260614927-208cfe3f5cfd',
  'overland-40l-travel-pack': 'photo-1499803270242-467f7311582d',

  // Shelter & Sleep
  'aurora-2p-tent': 'photo-1504280390367-361c6d9f38f4',
  'basecamp-4p-dome-tent': 'photo-1631635589499-afd87d52bf64',
  'featherline-20f-down-bag': 'photo-1576176539998-0237d1ac6a85',
  'driftoff-sleeping-pad': 'photo-1537905569824-f89f14cceb68',
  'hollow-single-hammock': 'photo-1510312305653-8ed496efae75',
  'ridgetop-1p-bivy': 'photo-1571863533956-01c88e79957e',
  'lowland-30f-synthetic-bag': 'photo-1624923686627-514dd5e57bae',
  'shelter-tarp-3x3': 'photo-1532339142463-fd0a8979791a',

  // Base Layers & Apparel
  'merino-150-crew-tee': 'photo-1574201635302-388dd92a4c3f',
  'merino-250-half-zip': 'photo-1610901157620-340856d0a50f',
  'trailworn-hiking-pant': 'photo-1580331451062-99ff652288d7',
  'switchgrass-sun-hoodie': 'photo-1612629779374-a8432d338af5',
  'merino-blend-legging': 'photo-1604573824419-289a9a10672c',
  'fieldstone-flannel': 'photo-1607160199580-1b0c9b736b66',
  'quickdry-trail-short': 'photo-1636146049394-0924c2b66104',
  'merino-hiking-sock-3pk': 'photo-1633972767447-5098f0322a45',

  // Camp Kitchen
  'emberlight-canister-stove': 'photo-1522041350204-22285237eeca',
  'trail-enamel-mug': 'photo-1444012104069-996724bf4a0a',
  'basin-2p-cook-set': 'photo-1546890948-82b45c9712c2',
  'springwater-filter-bottle': 'photo-1619035226152-81e29823b8d9',
  'packdown-1l-kettle': 'photo-1652260957608-927b3320c705',
  'gravity-6l-reservoir': 'photo-1588324226938-d5a83e506134',
  'woodsmoke-folding-grill': 'photo-1477951324676-cd9dab85abd5',
  'titanium-spork-set': 'photo-1556807819-af575dbb114f',

  // Navigation & Light
  'beacon-400-headlamp': 'photo-1515444744559-7be63e1600de',
  'hearth-camp-lantern': 'photo-1517457773273-412ec74a18cd',
  'waypoint-handheld-gps': 'photo-1630275383125-2ecfa5f431d5',
  'truenorth-baseplate-compass': 'photo-1694043059942-fafbcbc5b747',
  'signal-satellite-messenger': 'photo-1654030056105-95d0ef394186',
  'packlight-string-lantern': 'photo-1704690879247-62a4062402cd',
  'dawnpatrol-800-headlamp': 'photo-1591804970159-efe5472ceb9b',
  'emberflare-signal-light': 'photo-1637013369304-191aa2b51232',

  // Accessories
  'summit-insulated-glove': 'photo-1611690889004-c009a7e03712',
  'ridgeline-merino-beanie': 'photo-1452689842785-5f14840dca48',
  'alpine-high-gaiter': 'photo-1511500118080-275313ec90a1',
  'carbon-trekking-pole-pair': 'photo-1771315655628-1f94975e6190',
  'fieldkit-first-aid': 'photo-1771253067425-e7f9bcc990bc',
  'packable-sun-hat': 'photo-1764787016272-f4e73ebd3256',
  'merino-neck-gaiter': 'photo-1769329426490-016eee4fbe84',
  'trail-repair-kit': 'photo-1768324523731-69dec620e6ec',
};
