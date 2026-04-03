# Privacy Policy

**Last updated:** April 3, 2026

Nepsis ("we", "our", or "the app") is a remote terminal relay tool that lets you control Mac terminal sessions from your iPhone or iPad. Your privacy matters to us. This policy explains what data we collect, how we use it, and your choices.

## Data We Collect

### Pairing & Connection Data

- **Pairing codes**: Temporary 6-character codes used to link your mobile device to your Mac. These expire after a few minutes and are not stored permanently.
- **Reconnect tokens**: Short-lived tokens stored securely on your device (iOS Keychain) to allow automatic reconnection. These never leave your device.

### Terminal Data

- **Terminal I/O**: Keystrokes you send and terminal output you receive are relayed through our server in real time. **We do not log, store, or inspect terminal data.** The relay server acts as a passthrough only.
- **End-to-end encryption**: All terminal data is encrypted between your devices. The relay server cannot read it.

### Data We Do NOT Collect

- No personal information (name, email, phone number)
- No analytics or usage tracking
- No advertising identifiers
- No location data
- No device fingerprinting
- No cookies

## How the Relay Works

Our relay server (`nepsis.stolenorbit.com`) routes encrypted WebSocket traffic between your mobile device and your Mac. It:

- Matches devices using temporary pairing codes
- Forwards encrypted binary frames between paired devices
- Does **not** store, log, or decrypt any terminal content
- Does **not** persist connection history

## Data Storage

- **On your device**: Pairing codes and reconnect tokens are stored in the iOS Keychain. Clearing the app or using "Forget this Mac" removes them.
- **On the relay server**: No persistent data is stored. The server holds in-memory room state only while devices are connected. When you disconnect, the room is destroyed.

## Third-Party Services

Nepsis does not use any third-party analytics, crash reporting, or advertising services. The only external service involved is our self-hosted relay server.

## Children's Privacy

Nepsis does not knowingly collect any data from children under 13. The app does not collect personal information from any user.

## Changes to This Policy

If we update this policy, the changes will be reflected on this page with an updated date.

## Contact

If you have questions about this policy, reach out via our feedback form or open an issue on [GitHub](https://github.com/AlbertoNoris/nepsis/issues).
