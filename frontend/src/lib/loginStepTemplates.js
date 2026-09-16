/**
 * Predefined login step patterns per auth_type. These cover the common
 * cases (password login, optional su handshake). Users needing an
 * unusual prompt pattern can still hand-edit the generated steps
 * afterward via the "Advanced" section of the region form.
 *
 * Placeholders {username}, {password}, {service_username},
 * {service_password} are substituted by the backend at run time from
 * the region's stored credentials — never typed literally by the user.
 */

export const AUTH_TYPE_OPTIONS = [
  { value: 'password', label: 'Username & password only' },
  { value: 'password_su', label: 'Username & password, then switch user (su)' },
  { value: 'key', label: 'SSH key only' },
  { value: 'key_su', label: 'SSH key, then switch user (su)' },
];

/**
 * Returns the default ordered login steps for a given auth_type.
 * Each step: { step_order, expect_pattern, send_template, timeout_ms }
 */
export function buildDefaultLoginSteps(authType, { serviceUsername } = {}) {
  const suStep = (order) => [
    {
      step_order: order,
      expect_pattern: '[$#]\\s*$',
      send_template: `su ${serviceUsername || '{service_username}'}`,
      timeout_ms: 10000,
    },
    {
      step_order: order + 1,
      expect_pattern: '[Pp]assword:',
      send_template: '{service_password}',
      timeout_ms: 10000,
    },
  ];

  switch (authType) {
    case 'password':
      return [
        {
          step_order: 1,
          expect_pattern: '[Ll]ogin:|[Uu]sername:',
          send_template: '{username}',
          timeout_ms: 10000,
        },
        {
          step_order: 2,
          expect_pattern: '[Pp]assword:',
          send_template: '{password}',
          timeout_ms: 10000,
        },
      ];

    case 'password_su':
      return [
        {
          step_order: 1,
          expect_pattern: '[Ll]ogin:|[Uu]sername:',
          send_template: '{username}',
          timeout_ms: 10000,
        },
        {
          step_order: 2,
          expect_pattern: '[Pp]assword:',
          send_template: '{password}',
          timeout_ms: 10000,
        },
        ...suStep(3),
      ];

    case 'key':
      // Key auth skips the interactive login prompt entirely — the
      // ssh2 client authenticates during connect(), so no steps needed
      // before the shell is ready.
      return [];

    case 'key_su':
      return [...suStep(1)];

    default:
      return [];
  }
}
