import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ThankYouPage from './ThankYouPage';
import { ConfigContext } from '../ConfigContext';

const thankyou = {
  title: 'Thank You!', successMessage: 'Submitted.', submissionId: 'Your Submission ID:', saveId: 'Save this ID.',
  declineMessage: 'Not shared.', copyToClipboard: { copy: 'Copy', copied: 'Copied!' },
  deleteFile: 'For maximum security, please now delete the file you uploaded everywhere it is.',
};
const show = (state, thankyouConfig = thankyou) => render(
  <ConfigContext.Provider value={{ page: { thankyou: thankyouConfig } }}>
    <MemoryRouter initialEntries={[{ pathname: '/thank-you', state }]}><ThankYouPage /></MemoryRouter>
  </ConfigContext.Provider>,
);

test('after a donation the page tells the donor to delete the uploaded file, next to the submission ID', () => {
  show({ donated: true, submissionId: '1234567890123456' });
  expect(screen.getByText('Save this ID.')).toBeInTheDocument();
  expect(screen.getByTestId('delete-file-advice')).toHaveTextContent(/maximum security.*delete the file you uploaded/);
});

test('after declining nothing was uploaded, so there is nothing to delete', () => {
  show({ donated: false });
  expect(screen.getByText('Not shared.')).toBeInTheDocument();
  expect(screen.queryByTestId('delete-file-advice')).toBeNull();
});

test('a config without the advice still renders as before', () => {
  const { deleteFile, ...older } = thankyou;
  show({ donated: true, submissionId: '1234567890123456' }, older);
  expect(screen.getByText('Submitted.')).toBeInTheDocument();
  expect(screen.queryByTestId('delete-file-advice')).toBeNull();
});
