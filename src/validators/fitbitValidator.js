import createTableValidator from './tableValidator';

/** Valid when the Fitbit / Google Health Takeout produced at least one table with rows. */
export default createTableValidator('No Fitbit activity, sleep or exercise data found in the uploaded export');
