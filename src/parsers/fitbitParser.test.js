import JSZip from 'jszip';
import parseFitbitFile from './fitbitParser';
import validateFitbitData from '../validators/fitbitValidator';
import { parseMdy, parseIso, parseOffset, formatOffset, Localizer } from './fitbitTime';

// Synthetic Takeout mixing the legacy JSON layout ("Global Export Data") and
// the 2026 "Google Health" CSV layout, as real exports do. Real exports hold
// personal data, so none is committed.
const G = 'Takeout/Google Health/';
const PA = `${G}Physical Activity_GoogleData/`;
const HF = `${G}Health Fitness Data_GoogleData/`;
const GE = `${G}Global Export Data/`;
const csv = (header, rows) => [header, ...rows].join('\n') + '\n';

const files = {
  [`${GE}steps-2026-01-01.json`]: JSON.stringify([
    { dateTime: '01/10/26 08:00:00', value: '900' },
    { dateTime: '01/10/26 22:30:00', value: '100' }, // 23:30 local
    { dateTime: '01/10/26 23:30:00', value: '50' }, // 00:30 local on Jan 11
  ]),
  [`${GE}distance-2026-01-01.json`]: JSON.stringify([{ dateTime: '01/10/26 08:00:00', value: '75000' }]), // cm
  [`${GE}calories-2026-01-01.json`]: JSON.stringify([{ dateTime: '01/10/26 23:30:00', value: '1.5' }]), // local
  [`${GE}heart_rate-2026-01-10.json`]: JSON.stringify([
    { dateTime: '01/10/26 08:00:05', value: { bpm: 60, confidence: 2 } },
    { dateTime: '01/10/26 08:00:10', value: { bpm: 80, confidence: 3 } },
  ]),
  [`${GE}lightly_active_minutes-2026-01-01.json`]: JSON.stringify([
    { dateTime: '01/10/26 00:00:00', value: '30' }, { dateTime: '01/20/26 00:00:00', value: '0' }]),
  [`${GE}moderately_active_minutes-2026-01-01.json`]: JSON.stringify([
    { dateTime: '01/10/26 00:00:00', value: '10' }, { dateTime: '01/20/26 00:00:00', value: '0' }]),
  [`${GE}very_active_minutes-2026-01-01.json`]: JSON.stringify([
    { dateTime: '01/10/26 00:00:00', value: '5' }, { dateTime: '01/20/26 00:00:00', value: '0' }]),
  [`${GE}sedentary_minutes-2026-01-01.json`]: JSON.stringify([
    { dateTime: '01/10/26 00:00:00', value: '600' }, { dateTime: '01/20/26 00:00:00', value: '1440' }]),
  [`${GE}resting_heart_rate-2026-01-01.json`]: JSON.stringify([
    { dateTime: '01/10/26 00:00:00', value: { date: '01/10/26', value: 55.4, error: 6 } },
    { dateTime: '01/12/26 00:00:00', value: { date: null, value: 0, error: 0 } },
  ]),
  [`${GE}sleep-2025-12-20.json`]: JSON.stringify([{
    logId: 1, dateOfSleep: '2026-01-10', startTime: '2026-01-09T23:00:00.000', endTime: '2026-01-10T07:00:00.000',
    minutesAsleep: 400, minutesAwake: 40, timeInBed: 480, efficiency: 92, type: 'stages', logType: 'auto_detected', mainSleep: true,
    levels: { summary: { deep: { minutes: 60 }, light: { minutes: 250 }, rem: { minutes: 90 }, wake: { minutes: 40 } } },
  }]),
  [`${GE}exercise-0.json`]: JSON.stringify([{
    logId: 9, activityName: 'Run', startTime: '01/10/26 18:00:00', duration: 1800000, activeDuration: 1800000,
    distance: 3.1, distanceUnit: 'Mile', calories: 300, steps: 4000, averageHeartRate: 150, logType: 'auto_detected',
    tcxLink: 'https://www.fitbit.com/activities/exercise/9?export=tcx',
  }]),
  [`${G}Sleep Score/sleep_score.csv`]: csv('sleep_log_entry_id,timestamp,overall_score', ['1,2026-01-10T07:00:00Z,80']),
  [`${HF}UserSleeps_2026-01-01.csv`]: csv(
    'sleep_id,sleep_type,minutes_in_sleep_period,minutes_asleep,minutes_awake,start_utc_offset,sleep_start,end_utc_offset,sleep_end,data_source',
    [
      '700,STAGES,480,400,40,+01:00,2026-01-09T22:00:00Z,+01:00,2026-01-10T06:00:00Z,DEVICE', // duplicate of JSON
      '701,STAGES,450,450,0,+01:00,2026-01-11T22:30:00Z,+01:00,2026-01-12T06:00:00Z,DEVICE',
    ],
  ),
  [`${HF}UserSleepStages_2026-01-01.csv`]: csv(
    'sleep_id,sleep_stage_id,sleep_stage_type,start_utc_offset,sleep_stage_start,end_utc_offset,sleep_stage_end,data_source',
    [
      '701,1,DEEP,+01:00,2026-01-11T22:30:00Z,+01:00,2026-01-11T23:30:00Z,DEVICE',
      '701,2,LIGHT,+01:00,2026-01-11T23:30:00Z,+01:00,2026-01-12T05:00:00Z,DEVICE',
      '701,3,REM,+01:00,2026-01-12T05:00:00Z,+01:00,2026-01-12T06:00:00Z,DEVICE',
    ],
  ),
  [`${HF}UserExercises_2026-01-01.csv`]: csv(
    'exercise_id,exercise_start,exercise_end,utc_offset,activity_name,log_type,tracker_total_calories,tracker_total_steps,tracker_total_distance_mm,tracker_avg_heart_rate,tracker_peak_heart_rate,events',
    [
      '1,2026-01-10T17:00:00Z,2026-01-10T17:30:00Z,+01:00,Run,TRACKER,300,4000,5000000,150,170,"[Type: SPLIT, Timestamp: x]"',
      '2,2026-01-15T07:00:00Z,2026-01-15T08:00:00Z,+01:00,Outdoor Bike,TRACKER,500,0,20000000,130,160,""',
    ],
  ),
  [`${PA}Steps/steps_2026-01-01.csv`]: csv('timestamp,steps,data source', [
    '2026-01-10T09:00:00.000Z,9999,Google Health App', // ignored: JSON covers Jan 10
    '2026-01-15T09:00:00.000Z,4000,Google Health App',
    '2026-01-15T09:00:00.000Z,4100,Fit Health Connect',
    '2026-01-15T09:00:00.000Z,3000,Google Pixel Watch 3',
    '2026-01-16T09:00:00.000Z,2500,Fit Health Connect',
  ]),
  [`${PA}Heart Rate/heart_rate_2026-01-01.csv`]: csv('timestamp,beats per minute,data source', [
    '2026-01-15T09:00:00Z,70.0,Google Pixel Watch 3', '2026-01-15T09:00:05Z,90.0,Google Pixel Watch 3',
  ]),
  [`${PA}Daily Resting Heart Rate/daily_resting_heart_rate_2026-01-01.csv`]: csv('timestamp,beats per minute,data source',
    ['2026-01-15T00:00:00Z,58.0,Google Health App']),
  [`${PA}Coarse Physical Location/coarse_location_2026-01-01.csv`]: csv('timestamp,latitude,longitude', ['2026-01-15T09:00:00Z,51.2432,-0.5876']),
  [`${G}Your Profile/Profile.csv`]: csv('id,full_name,email_address,date_of_birth', ['X,Jane Doe,jane@example.com,1990-01-01']),
  [`${G}Paired Devices/Trackers.csv`]: csv('tracker_id,device_type', ['1,Pixel Watch 3']),
};

const takeout = async (entries = files) => {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return new Blob([await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })]);
};

describe('fitbitTime', () => {
  test('parsers', () => {
    expect(parseMdy('01/25/25 13:00:07')).toBe(Date.UTC(2025, 0, 25, 13, 0, 7));
    expect(parseIso('2026-01-01T08:00:00.000Z')).toBe(Date.UTC(2026, 0, 1, 8));
    expect(parseIso('2025-12-03 21:12:30+0000')).toBe(Date.UTC(2025, 11, 3, 21, 12, 30));
    expect(parseIso('2026-01-01T23:10:00.000')).toBe(Date.UTC(2026, 0, 1, 23, 10)); // naive = wall clock
    expect(parseOffset('+05:30')).toBe(330);
    expect(parseOffset('UTC-0400')).toBe(-240);
    expect(formatOffset(-90)).toBe('-01:30');
  });

  test('Localizer uses the nearest observed offset and exact quarter-hour days', () => {
    const loc = new Localizer();
    loc.observe(Date.UTC(2026, 0, 1), 330);
    loc.observe(Date.UTC(2026, 6, 1), 60);
    expect(loc.offsetAt(Date.UTC(2026, 1, 1))).toBe(330);
    expect(loc.offsetAt(Date.UTC(2026, 5, 1))).toBe(60);
    // 18:29Z is 23:59 IST; 18:30Z is the next day.
    expect(loc.localDayOf(Date.UTC(2026, 0, 2, 18, 29)).day).toBe('2026-01-02');
    expect(loc.localDayOf(Date.UTC(2026, 0, 2, 18, 30)).day).toBe('2026-01-03');
  });
});

describe('parseFitbitFile', () => {
  let result;
  beforeAll(async () => {
    result = await parseFitbitFile(await takeout());
  });

  test('builds the three tables and validates', () => {
    expect(Object.keys(result.data)).toEqual(['Daily Activity', 'Sleep', 'Exercise']);
    expect(validateFitbitData(result).valid).toBe(true);
  });

  test('UTC minute streams land on local days; JSON beats CSV', () => {
    const byDate = Object.fromEntries(result.data['Daily Activity'].map((r) => [r.Date, r]));
    expect(byDate['2026-01-10'].Steps).toBe('1000');
    expect(byDate['2026-01-11'].Steps).toBe('50');
    expect(byDate['2026-01-10']['Distance (km)']).toBe('0.75');
    expect(byDate['2026-01-10']['Calories (kcal)']).toBe('2'); // local-time calories stay on Jan 10
    expect(byDate['2026-01-10']['Avg HR (bpm)']).toBe('70');
    expect(byDate['2026-01-10']['Resting HR (bpm)']).toBe('55');
    expect(byDate['2026-01-10']['Lightly Active (min)']).toBe('30');
    expect(byDate['2026-01-10']['Sedentary (min)']).toBe('600');
    expect(byDate['2026-01-10']['UTC Offset']).toBe('+01:00');
  });

  test('CSV sources are never summed; Health Connect only as a fallback', () => {
    const byDate = Object.fromEntries(result.data['Daily Activity'].map((r) => [r.Date, r]));
    expect(byDate['2026-01-15'].Steps).toBe('4000');
    expect(byDate['2026-01-15']['Avg HR (bpm)']).toBe('80');
    expect(byDate['2026-01-15']['Resting HR (bpm)']).toBe('58');
    expect(byDate['2026-01-16'].Steps).toBe('2500');
  });

  test('placeholder days are dropped', () => {
    const dates = result.data['Daily Activity'].map((r) => r.Date);
    expect(dates).not.toContain('2026-01-20');
  });

  test('sleep: JSON in local time, CSV via its offsets, duplicates merged', () => {
    const [a, b] = result.data.Sleep;
    expect(result.data.Sleep).toHaveLength(2);
    expect(a).toMatchObject({
      Date: '2026-01-10', 'Sleep Start': '2026-01-09 23:00', 'Sleep End': '2026-01-10 07:00',
      'Main Sleep': 'Yes', Type: 'Stages', 'Asleep (min)': '400', 'Deep (min)': '60', 'REM (min)': '90',
      'Efficiency (%)': '92', 'Sleep Score': '80', Source: 'auto_detected',
    });
    expect(b).toMatchObject({
      Date: '2026-01-12', 'Sleep Start': '2026-01-11 23:30', 'Sleep End': '2026-01-12 07:00',
      'Deep (min)': '60', 'Light (min)': '330', 'REM (min)': '60', Source: 'DEVICE',
    });
  });

  test('exercise: JSON miles → km, CSV mm → km, duplicates merged', () => {
    const [run, bike] = result.data.Exercise;
    expect(result.data.Exercise).toHaveLength(2);
    expect(run).toMatchObject({ Activity: 'Run', 'Start Time': '2026-01-10 18:00', 'Distance (km)': '4.99', Steps: '4000', 'Avg HR (bpm)': '150' });
    expect(bike).toMatchObject({ Activity: 'Outdoor Bike', 'Start Time': '2026-01-15 08:00', 'Distance (km)': '20', 'Max HR (bpm)': '160', 'Duration (min)': '60' });
  });

  test('never reads profile, devices, location or links', () => {
    const json = JSON.stringify(result.data);
    for (const leak of ['Jane', 'jane@', '1990-01-01', 'Pixel Watch', '51.24', 'tcx', 'fitbit.com']) {
      expect(json).not.toContain(leak);
    }
  });

  test('rejects archives without Fitbit data', async () => {
    const res = await parseFitbitFile(await takeout({ 'Takeout/YouTube/history.json': '[]' }));
    expect(res.data).toEqual({});
    expect(validateFitbitData(res).valid).toBe(false);
    const res2 = await parseFitbitFile(new Blob(['nope']));
    expect(res2.parsingErrors.tablesNotParsed[0].reason).toMatch(/ZIP/);
  });
});
