import createTableValidator from './tableValidator';

/** Valid when the Apple Health export produced at least one table with rows. */
export default createTableValidator('No Apple Health activity, sleep or workout data found in the uploaded export');
