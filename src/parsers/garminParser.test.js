import JSZip from 'jszip';
import parseGarminFile from './garminParser';
import validateGarminData from '../validators/garminValidator';

// The real Garmin export contains personal data (name, email), so tests build a
// synthetic in-memory zip mirroring the export's structure instead of using a
// committed fixture.

const udsDay = (date, overrides = {}) => ({
  calendarDate: date,
  totalKilocalories: 1646.0,
  activeKilocalories: 211.0,
  totalSteps: 7142,
  totalDistanceMeters: 4799,
  highlyActiveSeconds: 588,
  activeSeconds: 2982,
  moderateIntensityMinutes: 7,
  vigorousIntensityMinutes: 4,
  floorsAscendedInMeters: 13.217,
  minHeartRate: 63,
  maxHeartRate: 138,
  restingHeartRate: 67,
  allDayStress: {
    aggregatorList: [
      {
        type: 'TOTAL',
        averageStressLevel: 39,
        maxStressLevel: 79,
        totalStressCount: 1440,
        stressOffWristCount: 144,
        stressDuration: 7080,
        restDuration: 3840,
      },
    ],
  },
  bodyBattery: {
    chargedValue: 81,
    drainedValue: 51,
    bodyBatteryStatList: [
      { bodyBatteryStatType: 'HIGHEST', statsValue: 83 },
      { bodyBatteryStatType: 'LOWEST', statsValue: 8 },
    ],
  },
  respiration: {
    avgWakingRespirationValue: 13.0,
    highestRespirationValue: 17.0,
    lowestRespirationValue: 10.0,
  },
  ...overrides,
});

const sleepNight = (date) => ({
  sleepStartTimestampGMT: '2024-01-19T23:21:00.0',
  sleepEndTimestampGMT: '2024-01-20T08:44:00.0',
  calendarDate: date,
  deepSleepSeconds: 3720,
  lightSleepSeconds: 23820,
  remSleepSeconds: 2940,
  awakeSleepSeconds: 3300,
  averageRespiration: 14.0,
  awakeCount: 4,
  restlessMomentCount: 52,
  sleepScores: { overallScore: 66 },
});

const activity = () => ({
  activityId: 1,
  name: 'Cambridge Treadmill Running', // Garmin auto-names embed location — must be dropped

  activityType: 'treadmill_running',
  beginTimestamp: 1778527153000,
  startTimeGmt: 1778527153000.0,
  startTimeLocal: 1778530753000.0,
  duration: 765429.99, // ms
  distance: 166142.0, // cm
  avgSpeed: 0.2171, // cm/ms
  avgHr: 142.0,
  maxHr: 160.0,
  steps: 1876.0,
  calories: 398.05,
  startLatitude: 51.24,
  startLongitude: -0.59,
});

const vo2Rec = (date, vo2, extra = {}) => ({
  calendarDate: date,
  deviceId: 3461959534,
  userProfilePK: 119668965,
  updateTimestamp: `${date}T10:00:00.0`,
  vo2MaxValue: vo2,
  maxMet: vo2 / 3.5,
  maxMetCategory: 'GENERIC',
  calibratedData: 0,
  ...extra,
});

const buildZip = async ({
  uds = true, sleep = true, activities = true, devices = true, vo2max = true,
} = {}) => {
  const zip = new JSZip();
  if (uds) {
    // Two files sharing the boundary date 2025-07-17; the richer record (with
    // restingHeartRate) must win the dedupe.
    zip.file(
      'DI_CONNECT/DI-Connect-Aggregator/UDSFile_2025-04-08_2025-07-17.json',
      JSON.stringify([
        udsDay('2025-04-08'),
        udsDay('2025-07-17', { restingHeartRate: undefined, totalSteps: 1 }),
        // Goal-only day (watch not worn) — must be skipped.
        { calendarDate: '2025-04-09', totalKilocalories: 1435.0, dailyStepGoal: 8220 },
        // Worn enough to keep, but Garmin's -1 stress sentinel must become blank.
        udsDay('2025-04-10', {
          allDayStress: {
            aggregatorList: [{
              type: 'TOTAL',
              averageStressLevel: -1,
              maxStressLevel: 0,
              totalStressCount: 1440,
              stressOffWristCount: 1440,
              stressDuration: 0,
              restDuration: 0,
            }],
          },
          bodyBattery: undefined,
          respiration: undefined,
        }),
      ])
    );
    zip.file(
      'DI_CONNECT/DI-Connect-Aggregator/UDSFile_2025-07-17_2025-10-25.json',
      JSON.stringify([udsDay('2025-07-17', { totalSteps: 9999 })])
    );
  }
  if (sleep) {
    zip.file(
      'DI_CONNECT/DI-Connect-Wellness/2024-01-20_2026-02-25_119668965_sleepData.json',
      JSON.stringify([sleepNight('2024-01-20')])
    );
  }
  if (activities) {
    zip.file(
      'DI_CONNECT/DI-Connect-Fitness/user@example.com_1_summarizedActivities.json',
      JSON.stringify([{ summarizedActivitiesExport: [activity()] }])
    );
  }
  if (vo2max) {
    zip.file(
      'DI_CONNECT/DI-Connect-Metrics/MetricsMaxMetData_20250408_20250717_1.json',
      JSON.stringify([
        vo2Rec('2025-04-08', 48.0, { updateTimestamp: '2025-04-08T10:00:00.0' }),
        vo2Rec('2025-04-08', 49.0, { updateTimestamp: '2025-04-08T18:00:00.0' }),
        vo2Rec('2025-04-09', 50.0, { sport: 'RUNNING', updateTimestamp: '2025-04-09T09:00:00.0' }),
      ])
    );
    zip.file(
      'DI_CONNECT/DI-Connect-Metrics/MetricsMaxMetData_20250717_20251025_1.json',
      JSON.stringify([
        vo2Rec('2025-04-08', 47.0, { updateTimestamp: '2025-04-08T12:00:00.0' }),
      ])
    );
  }
  if (devices) {
    zip.file(
      'IT_DEVICE_AND_CONTENT/devicesandcontent.json',
      JSON.stringify({
        deviceAndContentInfo: [
          {
            Devices: [
              {
                unitId: '3461959534',
                serialNumber: '6TG163300',
                partNumber: '010-02429-11',
                registrationDate: 'December 24, 2023',
              },
              {
                unitId: '999',
                serialNumber: 'SECRET',
                partNumber: '010-99999-00',
                registrationDate: 'January 1, 2024',
              },
            ],
          },
        ],
      })
    );
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return new File([buffer], 'garmin-export.zip', { type: 'application/zip' });
};

describe('garminParser', () => {
  it('parses wellness, sleep, activity, VO2max, and device tables from a Garmin export zip', async () => {
    const file = await buildZip();
    const { data, parsingErrors } = await parseGarminFile(file);

    expect(parsingErrors.sheetsNotFound).toEqual([]);
    expect(parsingErrors.tablesNotParsed).toEqual([]);
    expect(Object.keys(data).sort()).toEqual([
      'Activities', 'Daily Wellness', 'Devices', 'Sleep', 'VO2max',
    ]);
  });

  it('deduplicates boundary dates and skips goal-only days in Daily Wellness', async () => {
    const file = await buildZip();
    const { data } = await parseGarminFile(file);
    const rows = data['Daily Wellness'];

    // 2025-04-08 + one 2025-07-17 (deduped) + 2025-04-10; goal-only 2025-04-09 skipped.
    expect(rows.map((r) => r.Date)).toEqual(['2025-04-08', '2025-04-10', '2025-07-17']);
    const boundary = rows.find((r) => r.Date === '2025-07-17');
    // The second file's richer record (restingHeartRate present) wins over the
    // first file's sparser boundary record.
    expect(boundary['Resting HR (bpm)']).toBe('67');
    expect(boundary.Steps).toBe('9999');

    const first = rows[0];
    expect(first.Steps).toBe('7142');
    expect(first['Distance (km)']).toBe('4.8');
    expect(first['Active Time (min)']).toBe('50');
    expect(first['Max HR (bpm)']).toBe('138');
    expect(first['Wear Time (min)']).toBe('1296');
    expect(first['Avg Stress']).toBe('39');
    expect(first['Max Stress']).toBe('79');
    expect(first['Stress Time (min)']).toBe('118');
    expect(first['Rest Time (min)']).toBe('64');
    expect(first['Body Battery High']).toBe('83');
    expect(first['Body Battery Low']).toBe('8');
    expect(first['Body Battery Charged']).toBe('81');
    expect(first['Body Battery Drained']).toBe('51');
    expect(first['Avg Waking Respiration (brpm)']).toBe('13');
    expect(first['Min Respiration (brpm)']).toBe('10');
    expect(first['Max Respiration (brpm)']).toBe('17');
    expect(typeof first._timestamp).toBe('number');

    const sentinel = rows.find((r) => r.Date === '2025-04-10');
    expect(sentinel['Wear Time (min)']).toBe('0');
    expect(sentinel['Avg Stress']).toBe('');
    expect(sentinel['Max Stress']).toBe('');
    expect(sentinel['Stress Time (min)']).toBe('');
    expect(sentinel['Body Battery High']).toBe('');
    expect(sentinel['Avg Waking Respiration (brpm)']).toBe('');
  });

  it('converts sleep stages to minutes and reads the sleep score', async () => {
    const file = await buildZip();
    const [night] = (await parseGarminFile(file)).data['Sleep'];

    expect(night.Date).toBe('2024-01-20');
    expect(night['Deep (min)']).toBe('62');
    expect(night['Light (min)']).toBe('397');
    expect(night['REM (min)']).toBe('49');
    expect(night['Awake (min)']).toBe('55');
    expect(night['Total Sleep']).toBe('8 hours 28 minutes');
    expect(night['Sleep Score']).toBe('66');
    expect(night['Sleep Start']).toContain('GMT');
  });

  it('converts Garmin activity units (cm, ms, cm/ms) and drops location', async () => {
    const file = await buildZip();
    const [run] = (await parseGarminFile(file)).data['Activities'];

    expect(run.Activity).toBe('Treadmill Running');
    expect(run['Distance (km)']).toBe('1.66');
    expect(run.Duration).toBe('12 minutes 45 seconds');
    expect(run['Avg Speed (km/h)']).toBe('7.8');
    expect(run['Avg HR (bpm)']).toBe('142');
    expect(run._app).toBe('Treadmill Running');
    expect(run._timestamp).toBe(1778527153000);
    const joined = JSON.stringify(run);
    expect(joined).not.toContain('51.24');
    expect(joined).not.toContain('-0.59');
    expect(joined).not.toContain('Cambridge'); // location-bearing activity name dropped
  });

  it('looks up the device model and drops serial / unit IDs', async () => {
    const file = await buildZip();
    const devices = (await parseGarminFile(file)).data['Devices'];

    expect(devices).toEqual([
      {
        Model: 'Venu 2S',
        'Part Number': '010-02429-11',
        'Registration Date': 'December 24, 2023',
      },
      {
        Model: '010-99999-00',
        'Part Number': '010-99999-00',
        'Registration Date': 'January 1, 2024',
      },
    ]);
    const joined = JSON.stringify(devices);
    expect(joined).not.toContain('3461959534');
    expect(joined).not.toContain('6TG163300');
    expect(joined).not.toContain('SECRET');
  });

  it('keeps the latest VO2max per day and sport and drops device IDs', async () => {
    const file = await buildZip();
    const rows = (await parseGarminFile(file)).data['VO2max'];

    expect(rows.map((r) => ({ Date: r.Date, VO2max: r.VO2max, Sport: r.Sport }))).toEqual([
      { Date: '2025-04-08', VO2max: '49', Sport: '' },
      { Date: '2025-04-09', VO2max: '50', Sport: 'Running' },
    ]);
    const joined = JSON.stringify(rows);
    expect(joined).not.toContain('3461959534');
    expect(joined).not.toContain('119668965');
  });

  it('omits VO2max without error when MetricsMaxMetData is absent', async () => {
    const file = await buildZip({ vo2max: false });
    const { data, parsingErrors } = await parseGarminFile(file);

    expect(data['VO2max']).toBeUndefined();
    expect(parsingErrors.sheetsNotFound).not.toContain('VO2max');
  });

  it('reports missing sources without failing the others', async () => {
    const file = await buildZip({ sleep: false, devices: false, vo2max: false });
    const { data, parsingErrors } = await parseGarminFile(file);

    expect(Object.keys(data).sort()).toEqual(['Activities', 'Daily Wellness']);
    expect(parsingErrors.sheetsNotFound).toEqual(
      expect.arrayContaining(['Sleep data', 'Devices'])
    );
  });

  it('fails validation for a zip with no Garmin data', async () => {
    const zip = new JSZip();
    zip.file('unrelated.txt', 'hello');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const file = new File([buffer], 'not-garmin.zip', { type: 'application/zip' });

    const parseResult = await parseGarminFile(file);
    expect(validateGarminData(parseResult).valid).toBe(false);
    expect(validateGarminData(await parseGarminFile(await buildZip())).valid).toBe(true);
  });
});
