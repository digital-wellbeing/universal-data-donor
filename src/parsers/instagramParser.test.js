import JSZip from 'jszip';
import parseInstagramFile, { fixMojibake, recordTime } from './instagramParser';
import validateInstagramData from '../validators/instagramValidator';

// Synthetic export mixing the older string_list_data / string_map_data
// records with the 2025+ label_values schema, as real exports do.
const ROOT = 'instagram-someone-2026-02-01/';
const T = (iso) => Math.floor(Date.parse(iso) / 1000);
// Meta writes UTF-8 bytes as separate code points ("Café" → "CafÃ©").
const mojibake = (s) => String.fromCharCode(...new TextEncoder().encode(s));

const files = {
  'ads_information/ads_and_topics/posts_viewed.json': [
    { timestamp: T('2026-01-10T09:00:00Z'), media: [], label_values: [{ label: 'URL', value: 'https://www.instagram.com/p/SECRETPOST/' }, { title: 'Owner', dict: [{ dict: [{ label: 'Username', value: 'third_party_user' }] }] }] },
    { timestamp: T('2026-01-10T10:00:00Z'), media: [], label_values: [] },
  ],
  'ads_information/ads_and_topics/videos_watched.json': {
    impressions_history_videos_watched: [{ string_map_data: { Author: { value: 'video_author' }, Time: { timestamp: T('2026-01-11T12:00:00Z') } } }],
  },
  'your_instagram_activity/likes/liked_posts.json': {
    likes_media_likes: [{ title: 'liked_owner', string_list_data: [{ href: 'https://www.instagram.com/p/LIKED/', value: mojibake('👍'), timestamp: T('2026-01-10T20:00:00Z') }] }],
  },
  'your_instagram_activity/comments/post_comments_1.json': [
    { media_list_data: [{ uri: '' }], string_map_data: { Comment: { value: 'so jealous of your trip!' }, 'Media Owner': { value: 'friend_account' }, Time: { timestamp: T('2026-01-10T21:00:00Z') } } },
  ],
  'your_instagram_activity/media/posts_1.json': [
    { media: [{ uri: 'media/posts/202601/x.jpg', creation_timestamp: T('2026-01-11T08:00:00Z'), title: 'Holiday in Lisbon', media_metadata: { photo_metadata: { exif_data: [{ latitude: 38.72, longitude: -9.14 }] } } }] },
  ],
  'your_instagram_activity/media/archived_posts.json': { ig_archived_post_media: [{ media: [{ creation_timestamp: T('2026-01-11T08:00:00Z') }] }] },
  'your_instagram_activity/content/stories.json': { ig_stories: [{ uri: 'media/stories/x.mp4', creation_timestamp: T('2026-01-12T08:00:00Z'), title: 'story caption' }] },
  'logged_information/recent_searches/word_or_phrase_searches.json': {
    searches_keyword: [{ string_map_data: { Search: { value: 'divorce lawyer near me' }, Time: { timestamp: T('2026-01-12T22:00:00Z') } } }],
  },
  'connections/followers_and_following/following.json': {
    relationships_following: [{ title: 'followed_account', string_list_data: [{ href: 'https://www.instagram.com/_u/followed_account', timestamp: T('2026-01-12T09:00:00Z') }] }],
  },
  'connections/followers_and_following/followers_1.json': [
    { title: '', media_list_data: [], string_list_data: [{ href: 'https://www.instagram.com/follower_one', value: 'follower_one', timestamp: T('2026-01-12T10:00:00Z') }] },
  ],
  'preferences/your_topics/recommended_topics.json': {
    topics_your_topics: [{ string_map_data: { Name: { value: mojibake('Cafés') } } }, { string_map_data: { Name: { value: 'Football' } } }],
  },
  'personal_information/personal_information/personal_information.json': {
    profile_user: [{ string_map_data: { Username: { value: 'me_myself' }, Name: { value: mojibake('Zoë Example') }, 'Email address': { value: 'zoe@example.com' } } }],
  },
  'your_instagram_activity/messages/inbox/friendname_123/message_1.json': {
    participants: [{ name: 'Friend Name' }, { name: mojibake('Zoë Example') }],
    messages: [
      { sender_name: 'Friend Name', timestamp_ms: Date.parse('2026-01-10T18:00:00Z'), content: 'my address is 1 Secret Road' },
      { sender_name: mojibake('Zoë Example'), timestamp_ms: Date.parse('2026-01-10T18:05:00Z'), content: 'ok!' },
    ],
  },
  'security_and_login_information/login_and_profile_creation/login_activity.json': {
    account_history_login_history: [{ title: '2026-01-10T08:00:00+00:00', string_map_data: { 'IP Address': { value: '203.0.113.7' }, Time: { timestamp: T('2026-01-10T08:00:00Z') } } }],
  },
  // A Facebook export tree with the same file names must be ignored.
  'your_activity_across_facebook/likes/liked_posts.json': { likes_media_likes: [{ string_list_data: [{ timestamp: T('2026-01-15T08:00:00Z') }] }] },
};

const exportZip = async (entries = files, root = ROOT) => {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(root + name, typeof content === 'string' ? content : JSON.stringify(content));
  return new Blob([await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })]);
};

test('fixMojibake', () => {
  expect(fixMojibake(mojibake('👍 Zoë'))).toBe('👍 Zoë');
  expect(fixMojibake('plain')).toBe('plain');
  expect(fixMojibake('already ✓ fine')).toBe('already ✓ fine');
});

test('recordTime across schemas', () => {
  expect(recordTime({ timestamp: 100 })).toBe(100000);
  expect(recordTime({ string_list_data: [{ timestamp: 5 }] })).toBe(5000);
  expect(recordTime({ string_map_data: { Tijd: { timestamp: 7 } } })).toBe(7000);
  expect(recordTime({ label_values: [{ label: 'Time', timestamp_value: 9 }] })).toBe(9000);
  expect(recordTime({ media: [{ creation_timestamp: 3 }] })).toBe(3000);
  expect(recordTime({ timestamp: 0 })).toBeNaN();
});

describe('parseInstagramFile', () => {
  let result;
  beforeAll(async () => {
    result = await parseInstagramFile(await exportZip());
  });

  test('builds the tables and validates', () => {
    expect(Object.keys(result.data)).toEqual(['Daily Activity', 'Activity Totals', 'Topics']);
    expect(validateInstagramData(result).valid).toBe(true);
  });

  test('totals count every category once, ignoring archived posts and Facebook trees', () => {
    const totals = Object.fromEntries(result.data['Activity Totals'].map((r) => [r.Category, r.Count]));
    expect(totals).toEqual({
      'Posts Viewed': '2',
      'Videos Watched': '1',
      'Posts Liked': '1',
      'Comments Posted': '1',
      'Posts Published': '1',
      'Stories Published': '1',
      Searches: '1',
      'Accounts Followed': '1',
      'New Followers': '1',
      'Messages Sent': '1',
      'Messages Received': '1',
    });
  });

  test('daily rows carry a count per category', () => {
    const rows = result.data['Daily Activity'];
    const total = (c) => rows.reduce((a, r) => a + Number(r[c]), 0);
    expect(total('Posts Viewed')).toBe(2);
    expect(total('Messages Sent')).toBe(1);
    expect(rows.every((r) => typeof r._timestamp === 'number')).toBe(true);
  });

  test('topics are decoded', () => {
    expect(result.data.Topics).toEqual([{ Topic: 'Cafés' }, { Topic: 'Football' }]);
  });

  test('never emits third-party or personal content', () => {
    const json = JSON.stringify(result.data);
    for (const leak of ['third_party_user', 'SECRETPOST', 'instagram.com', 'video_author', 'liked_owner', 'jealous',
      'friend_account', 'Lisbon', '38.72', 'story caption', 'divorce', 'followed_account', 'follower_one',
      'Friend Name', 'Secret Road', 'Zo', 'me_myself', 'zoe@', '203.0.113', 'media/']) {
      expect(json).not.toContain(leak);
    }
  });

  test('without a profile, the participant in most threads is "me"', async () => {
    const entries = {
      'your_instagram_activity/messages/inbox/a_1/message_1.json': {
        participants: [{ name: 'A' }, { name: 'Me' }], messages: [{ sender_name: 'Me', timestamp_ms: 1767000000000 }, { sender_name: 'A', timestamp_ms: 1767000001000 }],
      },
      'your_instagram_activity/messages/inbox/b_2/message_1.json': {
        participants: [{ name: 'B' }, { name: 'Me' }], messages: [{ sender_name: 'Me', timestamp_ms: 1767000002000 }],
      },
    };
    const res = await parseInstagramFile(await exportZip(entries, ''));
    const totals = Object.fromEntries(res.data['Activity Totals'].map((r) => [r.Category, r.Count]));
    expect(totals).toEqual({ 'Messages Sent': '2', 'Messages Received': '1' });
  });

  test('out-of-range timestamps are skipped instead of throwing', async () => {
    const res = await parseInstagramFile(await exportZip({
      'your_instagram_activity/likes/liked_posts.json': { likes_media_likes: [
        { string_list_data: [{ timestamp: 1.7e13 }] }, // ms in a seconds field
        { string_list_data: [{ timestamp: 1767000000 }] },
      ] },
    }));
    expect(res.data['Activity Totals']).toEqual([expect.objectContaining({ Category: 'Posts Liked', Count: '1' })]);
  });

  test('rejects HTML-format and unrelated exports', async () => {
    const res = await parseInstagramFile(await exportZip({ 'your_instagram_activity/likes/liked_posts.html': '<html></html>' }));
    expect(res.data).toEqual({});
    expect(res.parsingErrors.tablesNotParsed[0].reason).toMatch(/JSON format/);
    expect(validateInstagramData(res).valid).toBe(false);
  });
});
