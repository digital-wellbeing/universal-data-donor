import JSZip from 'jszip';
import parseAppleHealthFile, { parseAppleDate, sourceLabel } from './appleHealthParser';
import validateAppleHealthData from '../validators/appleHealthValidator';

// Synthetic export.xml mirroring the real structure (DTD, <Me>, records with
// metadata children, workouts with statistics + GPS route, activity
// summaries, correlations). Real exports contain personal data, so no real
// fixture is committed.
const WATCH = 'device="&lt;&lt;HKDevice: 0x2836a1c20&gt;, name:Apple Watch, manufacturer:Apple Inc., model:Watch, hardware:Watch6,1, software:9.1&gt;"';
const PHONE = 'device="&lt;&lt;HKDevice: 0x2836a1d10&gt;, name:iPhone, manufacturer:Apple Inc., model:iPhone, hardware:iPhone13,2, software:16.1&gt;"';
const rec = (type, value, start, end, src, dev = '', unit = '', extra = '') =>
  `<Record type="${type}" sourceName="${src}" sourceVersion="9.1" ${dev} ${unit ? `unit="${unit}"` : ''} creationDate="${end}" startDate="${start}" endDate="${end}" value="${value}"${extra ? `>${extra}</Record>` : '/>'}`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!-- HealthKit Export Version: 14 -->
<!ELEMENT HealthData (ExportDate,Me,(Record|Correlation|Workout|ActivitySummary|ClinicalRecord)*)>
<!ATTLIST HealthData
  locale CDATA #REQUIRED
>
<!ELEMENT Record ((MetadataEntry|HeartRateVariabilityMetadataList)*)>
<!ATTLIST Record
  type          CDATA #REQUIRED
  value         CDATA #IMPLIED
>
]>
<HealthData locale="en_GB">
 <ExportDate value="2024-01-22 09:00:00 +0000"/>
 <Me HKCharacteristicTypeIdentifierDateOfBirth="1990-05-04" HKCharacteristicTypeIdentifierBiologicalSex="HKBiologicalSexFemale" HKCharacteristicTypeIdentifierBloodType="HKBloodTypeAPositive"/>
 ${rec('HKQuantityTypeIdentifierStepCount', 4000, '2024-01-20 08:00:00 +0000', '2024-01-20 09:00:00 +0000', 'Alex’s iPhone', PHONE, 'count')}
 ${rec('HKQuantityTypeIdentifierStepCount', 1000, '2024-01-20 18:00:00 +0000', '2024-01-20 19:00:00 +0000', 'Alex’s iPhone', PHONE, 'count')}
 ${rec('HKQuantityTypeIdentifierStepCount', 4500, '2024-01-20 08:00:00 +0000', '2024-01-20 09:00:00 +0000', 'Alex’s Apple Watch', WATCH, 'count')}
 ${rec('HKQuantityTypeIdentifierStepCount', 1200, '2024-01-20 18:00:00 +0000', '2024-01-20 19:00:00 +0000', 'Alex’s Apple Watch', WATCH, 'count')}
 ${rec('HKQuantityTypeIdentifierStepCount', 300, '2024-01-21 00:30:00 +0100', '2024-01-21 00:40:00 +0100', 'Alex’s Apple Watch', WATCH, 'count')}
 ${rec('HKQuantityTypeIdentifierDistanceWalkingRunning', 2, '2024-01-20 08:00:00 +0000', '2024-01-20 09:00:00 +0000', 'Alex’s Apple Watch', WATCH, 'mi')}
 ${rec('HKQuantityTypeIdentifierActiveEnergyBurned', 418.4, '2024-01-20 08:00:00 +0000', '2024-01-20 09:00:00 +0000', 'Alex’s Apple Watch', WATCH, 'kJ')}
 ${rec('HKQuantityTypeIdentifierFlightsClimbed', 3, '2024-01-20 08:00:00 +0000', '2024-01-20 08:10:00 +0000', 'Alex’s iPhone', PHONE, 'count')}
 ${rec('HKQuantityTypeIdentifierHeartRate', 60, '2024-01-20 08:00:00 +0000', '2024-01-20 08:00:00 +0000', 'Alex’s Apple Watch', WATCH, 'count/min', '<MetadataEntry key="HKMetadataKeyHeartRateMotionContext" value="0"/>')}
 ${rec('HKQuantityTypeIdentifierHeartRate', 120, '2024-01-20 08:30:00 +0000', '2024-01-20 08:30:00 +0000', 'Alex’s Apple Watch', WATCH, 'count/min')}
 ${rec('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 45.5, '2024-01-20 03:00:00 +0000', '2024-01-20 03:01:00 +0000', 'Alex’s Apple Watch', WATCH, 'ms', '<HeartRateVariabilityMetadataList><InstantaneousBeatsPerMinute bpm="58" time="3:00:01.00 AM"/></HeartRateVariabilityMetadataList>')}
 ${rec('HKQuantityTypeIdentifierOxygenSaturation', 0.97, '2024-01-20 03:00:00 +0000', '2024-01-20 03:00:00 +0000', 'Alex’s Apple Watch', WATCH, '%')}
 ${rec('HKQuantityTypeIdentifierRestingHeartRate', 55, '2024-01-20 00:00:00 +0000', '2024-01-20 23:59:00 +0000', 'Alex’s Apple Watch', WATCH, 'count/min')}
 ${rec('HKCategoryTypeIdentifierSexualActivity', 'HKCategoryValueNotApplicable', '2024-01-20 22:00:00 +0000', '2024-01-20 22:00:00 +0000', 'Alex’s iPhone', PHONE)}
 ${rec('HKQuantityTypeIdentifierBodyMass', 70, '2024-01-20 07:00:00 +0000', '2024-01-20 07:00:00 +0000', 'Scale App', '', 'kg')}
 ${rec('HKCategoryTypeIdentifierSleepAnalysis', 'HKCategoryValueSleepAnalysisInBed', '2024-01-19 22:30:00 +0000', '2024-01-20 06:45:00 +0000', 'Alex’s iPhone', PHONE)}
 ${rec('HKCategoryTypeIdentifierSleepAnalysis', 'HKCategoryValueSleepAnalysisAsleepCore', '2024-01-19 23:00:00 +0000', '2024-01-20 02:00:00 +0000', 'Alex’s Apple Watch', WATCH)}
 ${rec('HKCategoryTypeIdentifierSleepAnalysis', 'HKCategoryValueSleepAnalysisAsleepDeep', '2024-01-20 02:00:00 +0000', '2024-01-20 03:00:00 +0000', 'Alex’s Apple Watch', WATCH)}
 ${rec('HKCategoryTypeIdentifierSleepAnalysis', 'HKCategoryValueSleepAnalysisAwake', '2024-01-20 03:00:00 +0000', '2024-01-20 03:10:00 +0000', 'Alex’s Apple Watch', WATCH)}
 ${rec('HKCategoryTypeIdentifierSleepAnalysis', 'HKCategoryValueSleepAnalysisAsleepREM', '2024-01-20 03:10:00 +0000', '2024-01-20 04:40:00 +0000', 'Alex’s Apple Watch', WATCH)}
 ${rec('HKCategoryTypeIdentifierSleepAnalysis', 'HKCategoryValueSleepAnalysisAsleep', '2024-01-20 23:15:00 +0000', '2024-01-21 06:15:00 +0000', 'AutoSleep', '')}
 <Correlation type="HKCorrelationTypeIdentifierBloodPressure" sourceName="Omron" startDate="2024-01-20 07:00:00 +0000" endDate="2024-01-20 07:00:00 +0000">
  ${rec('HKQuantityTypeIdentifierHeartRate', 999, '2024-01-20 07:00:00 +0000', '2024-01-20 07:00:00 +0000', 'Omron', '', 'count/min')}
 </Correlation>
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" totalDistance="5" totalDistanceUnit="km" totalEnergyBurned="300" totalEnergyBurnedUnit="kcal" sourceName="Alex’s Apple Watch" sourceVersion="7.0" ${WATCH} creationDate="2024-01-20 08:31:00 +0000" startDate="2024-01-20 08:00:00 +0000" endDate="2024-01-20 08:30:00 +0000">
  <MetadataEntry key="HKIndoorWorkout" value="0"/>
  <WorkoutEvent type="HKWorkoutEventTypeSegment" date="2024-01-20 08:00:00 +0000"/>
  <WorkoutRoute sourceName="Alex’s Apple Watch" startDate="2024-01-20 08:00:00 +0000" endDate="2024-01-20 08:30:00 +0000">
   <FileReference path="/workout-routes/route_2024-01-20_8.30am.gpx"/>
  </WorkoutRoute>
 </Workout>
 <Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="2700" durationUnit="s" sourceName="Strava" startDate="2024-01-21 18:00:00 +0100" endDate="2024-01-21 18:45:00 +0100">
  <MetadataEntry key="HKIndoorWorkout" value="1"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" startDate="2024-01-21 18:00:00 +0100" endDate="2024-01-21 18:45:00 +0100" sum="250.4" unit="kcal"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" startDate="2024-01-21 18:00:00 +0100" endDate="2024-01-21 18:45:00 +0100" average="131.2" minimum="90" maximum="162" unit="count/min"/>
 </Workout>
 <ActivitySummary dateComponents="2024-01-20" activeEnergyBurned="512.5" activeEnergyBurnedGoal="500" activeEnergyBurnedUnit="kcal" appleMoveTime="0" appleMoveTimeGoal="0" appleExerciseTime="42" appleExerciseTimeGoal="30" appleStandHours="11" appleStandHoursGoal="12"/>
 <ActivitySummary dateComponents="0001-01-01" activeEnergyBurned="0" activeEnergyBurnedGoal="0" activeEnergyBurnedUnit="kcal"/>
 <ClinicalRecord type="HKClinicalTypeIdentifierLabResultRecord" identifier="x" sourceName="NHS" fhirVersion="4.0.1" receivedDate="2024-01-20 07:00:00 +0000" resourceFilePath="/clinical-records/x.json"/>
</HealthData>
`;

const asXmlFile = (xml = XML) => new Blob([xml], { type: 'text/xml' });
const asZipFile = async (xml = XML) => {
  const zip = new JSZip();
  zip.file('apple_health_export/export.xml', xml);
  zip.file('apple_health_export/export_cda.xml', '<ClinicalDocument>PRIVATE</ClinicalDocument>');
  zip.file('apple_health_export/workout-routes/route_2024-01-20_8.30am.gpx', '<gpx><trkpt lat="52.2" lon="0.12"/></gpx>');
  return new Blob([await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })]);
};

describe('parseAppleDate', () => {
  test('keeps the local day and offset', () => {
    expect(parseAppleDate('2024-01-21 00:30:00 +0100')).toEqual({
      ms: Date.UTC(2024, 0, 20, 23, 30),
      offset: 60,
      day: '2024-01-21',
    });
    expect(parseAppleDate('garbage')).toBeNull();
  });
});

describe('sourceLabel', () => {
  test('reduces Apple devices to their model and strips owner names', () => {
    expect(sourceLabel('Alex’s Apple Watch', '<<HKDevice: 0x1>, name:Apple Watch, manufacturer:Apple Inc., model:Watch, hardware:Watch6,1>'))
      .toBe('Apple Watch');
    expect(sourceLabel("Sam's iPhone", '')).toBe('iPhone');
    expect(sourceLabel('Strava', '')).toBe('Strava');
    expect(sourceLabel('Apple Watch von Test', '')).toBe('Apple Watch');
    expect(sourceLabel('iPhone de Marie', '')).toBe('iPhone');
    expect(sourceLabel('Montre de Marie', '')).toBe('Montre');
  });
});

describe('parseAppleHealthFile', () => {
  let result;
  beforeAll(async () => {
    result = await parseAppleHealthFile(await asZipFile());
  });

  test('produces the three tables and validates', () => {
    expect(Object.keys(result.data).sort()).toEqual(['Daily Activity', 'Sleep', 'Workouts']);
    expect(validateAppleHealthData(result).valid).toBe(true);
  });

  test('daily totals take the largest source instead of summing overlap', () => {
    const day = result.data['Daily Activity'].find((r) => r.Date === '2024-01-20');
    expect(day.Steps).toBe('5700'); // watch 5700 beats phone 5000; not 10700
    expect(day['Steps Source']).toBe('Apple Watch');
    expect(day['Distance (km)']).toBe('3.22'); // 2 mi
    expect(day['Active Energy (kcal)']).toBe('100'); // 418.4 kJ
    expect(day['Flights Climbed']).toBe('3');
    expect(day['Exercise (min)']).toBe('42');
    expect(day['Stand Hours']).toBe('11');
    expect(day['Move Goal (kcal)']).toBe('500');
    expect(day['Avg HR (bpm)']).toBe('90');
    expect(day['Min HR (bpm)']).toBe('60');
    expect(day['Max HR (bpm)']).toBe('120'); // the correlation's 999 is skipped
    expect(day['Resting HR (bpm)']).toBe('55');
    expect(day['HRV SDNN (ms)']).toBe('45.5');
    expect(day['SpO2 (%)']).toBe('97');
    expect(typeof day._timestamp).toBe('number');
  });

  test('a sample after local midnight lands on the local day', () => {
    const day = result.data['Daily Activity'].find((r) => r.Date === '2024-01-21');
    expect(day.Steps).toBe('300');
  });

  test('sleep picks the staged source and reports stages', () => {
    const night = result.data.Sleep.find((r) => r.Date === '2024-01-20');
    expect(night.Source).toBe('Apple Watch');
    expect(night['Core (min)']).toBe('180');
    expect(night['Deep (min)']).toBe('60');
    expect(night['REM (min)']).toBe('90');
    expect(night['Awake (min)']).toBe('10');
    expect(night['Asleep (min)']).toBe('330');
    expect(night['In Bed (min)']).toBe('495'); // from the iPhone's in-bed sample
    expect(night['Sleep Start']).toBe('2024-01-19 23:00');
    expect(night['Sleep End']).toBe('2024-01-20 04:40');
    expect(night['Sources Recorded']).toBe('2');

    const unstaged = result.data.Sleep.find((r) => r.Date === '2024-01-21');
    expect(unstaged.Source).toBe('AutoSleep');
    expect(unstaged['Unstaged Asleep (min)']).toBe('420');
    expect(unstaged['Core (min)']).toBe('');
  });

  test('workouts read both legacy attributes and WorkoutStatistics', () => {
    const [run, lift] = result.data.Workouts;
    expect(run.Activity).toBe('Running');
    expect(run['Start Time']).toBe('2024-01-20 08:00');
    expect(run['Duration (min)']).toBe('30');
    expect(run['Distance (km)']).toBe('5');
    expect(run['Active Energy (kcal)']).toBe('300');
    expect(run.Indoor).toBe('No');
    expect(run.Source).toBe('Apple Watch');
    expect(run._app).toBe('Running');

    expect(lift.Activity).toBe('Traditional Strength Training');
    expect(lift['Start Time']).toBe('2024-01-21 18:00');
    expect(lift['Duration (min)']).toBe('45');
    expect(lift['Active Energy (kcal)']).toBe('250');
    expect(lift['Avg HR (bpm)']).toBe('131');
    expect(lift['Max HR (bpm)']).toBe('162');
    expect(lift.Indoor).toBe('Yes');
  });

  test('never emits personal or excluded data', () => {
    const json = JSON.stringify(result.data);
    for (const leak of ['Alex', '1990-05-04', 'Female', 'BloodType', 'Sexual', 'gpx', 'lat=', 'PRIVATE', 'BodyMass', '"70"', 'NHS']) {
      expect(json).not.toContain(leak);
    }
  });

  test('accepts a bare export.xml with the same result', async () => {
    const fromXml = await parseAppleHealthFile(asXmlFile());
    expect(fromXml.data).toEqual(result.data);
  });

  test('rejects files that are not Apple Health exports', async () => {
    const res = await parseAppleHealthFile(new Blob(['<svg></svg>']));
    expect(res.data).toEqual({});
    expect(validateAppleHealthData(res).valid).toBe(false);

    const zip = new JSZip();
    zip.file('something.txt', 'hi');
    const res2 = await parseAppleHealthFile(new Blob([await zip.generateAsync({ type: 'uint8array' })]));
    expect(res2.parsingErrors.sheetsNotFound).toContain('export.xml');
  });
});

describe('localized exports', () => {
  test('finds a translated main file and ignores export_cda.xml', async () => {
    const zip = new JSZip();
    zip.file('apple_health_export/экспорт.xml', XML);
    zip.file('apple_health_export/export_cda.xml', `<HealthData>${'<x/>'.repeat(5000)}</HealthData>`);
    const res = await parseAppleHealthFile(new Blob([await zip.generateAsync({ type: 'uint8array' })]));
    expect(Object.keys(res.data).sort()).toEqual(['Daily Activity', 'Sleep', 'Workouts']);
  });
});
