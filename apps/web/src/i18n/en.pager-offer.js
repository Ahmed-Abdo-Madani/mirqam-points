/* English — Pager: the Loyalty program on the customer page and WhatsApp alerts from the business's own number (pager-offer.js). Merged into en.js. */
export default {
  pagerOffer: {
    offers: {
      title: 'Loyalty program on the customer page',
      hint: 'Pick, per branch, the program the customer’s waiting page offers: they join with their mobile number and get their card.',
      none: 'None',
      pick: 'Loyalty program for {branch}',
      noPrograms: 'No active programs. Activate one on the Programs page first.',
      inactive: '{name} (not active, hidden from customers)',
    },
    wa: {
      title: 'WhatsApp alerts',
      hint: 'The “your order is ready” message reaches the customer from your business’s WhatsApp number.',
      plusOnly: 'WhatsApp alerts come with the Pager Plus plan.',
      connected: 'Connected',
      notConnected: 'Not connected',
      whyOff: 'Link your business’s WhatsApp number so customers see “Notify me on WhatsApp”. We never send from another number.',
      whyOffDropped: 'The number disconnected, so customers no longer see “Notify me on WhatsApp”. Link it again to bring it back.',
      link: 'Link a WhatsApp number',
      relink: 'Link again',
      unlink: 'Unlink',
      unlinkConfirm: 'Unlink this number? Customers will no longer see the WhatsApp alert.',
      scan: 'On the business phone: WhatsApp › Linked devices › Link a device, then scan this code.',
      qrAlt: 'WhatsApp link code',
      qrExpired: 'This code expired. Press “Link again” for a new one.',
    },
    country: {
      title: 'Business country',
      hint: 'The phone field on the customer page starts with this country’s code; customers can pick any country.',
    },
  },
  errors: {
    program_not_offerable: 'This program is not active or the Loyalty subscription has ended. Pick an active program.',
    loyalty_inactive: 'The Mirqam Loyalty subscription is not active.',
    bridge_disabled: 'The link with Mirqam is not set up yet.',
    unauthorized: 'Not authorized.',
  },
}
