import createTableValidator from './tableValidator';

/** Valid when the Instagram export produced at least one table with rows. */
export default createTableValidator('No Instagram activity found in the uploaded export (was it downloaded in JSON format?)');
