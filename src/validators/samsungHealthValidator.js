import createTableValidator from './tableValidator';

/** Valid when the Samsung Health download produced at least one table with rows. */
export default createTableValidator('No Samsung Health activity, sleep or exercise data found in the uploaded file');
