import { InlineKeyboard } from 'grammy';

export function makeIRSocialChoiceKeyboard() {
  return new InlineKeyboard()
    .text('Bale', 'linkReqBale')
    .text('Rubika', 'linkReqRubika');
}

export function makeQueueListKeyboard(currentIndex: number, nextPage = true) {
  let keyboard = new InlineKeyboard();
  if (currentIndex) keyboard = keyboard.text('<-', `queue:${currentIndex - 1}`);
  keyboard = keyboard.text(`${currentIndex + 1}`, 'ignored');
  if (nextPage) keyboard = keyboard.text('->', `queue:${currentIndex + 1}`);
  return keyboard;
}

export function makeRequestKeyboard(
  compression: boolean,
  forceCompression: boolean,
) {
  return new InlineKeyboard()
    .text(
      `Compression: ${compression ? 'ON' : 'OFF'}`,
      forceCompression ? 'forceCompression' : 'toggleCompression',
    )
    .style('primary')
    .row()
    .text('❌ Cancel', 'cancelReq')
    .style('danger')
    .text('✅ Confirm', 'confirmReq')
    .style('success');
}

export function makeUploadKeyboard(
  hash: string,
  startButton: boolean,
  retry = false,
) {
  let keyboard = new InlineKeyboard()
    .text('Give up!', `giveUp:${hash}`)
    .style('danger');

  if (startButton)
    keyboard = keyboard
      .text(retry ? 'Retry' : 'Start', `uploadReq:${hash}`)
      .style('primary');

  return keyboard;
}

export function makeCopyPasswordKeyboard(password: string) {
  return new InlineKeyboard().copyText('File Password', password);
}
