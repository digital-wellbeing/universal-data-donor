import createTableValidator from './tableValidator';

/** Valid when the Health Connect export produced at least one table with rows. */
export default createTableValidator('No Health Connect activity, sleep or exercise data found in the uploaded export');
