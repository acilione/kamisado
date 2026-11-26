type PlayMode = 'computer' | 'host' | 'join';

/** A single settings form shared by computer and hosted matches. */
export function installMainMenu(initial: PlayMode, peerGuest: boolean): { select(mode: PlayMode): void } {
    const menu = document.getElementById('menu-screen')!;
    const picker = document.getElementById('play-mode-picker')!;
    const buttons = picker.querySelectorAll<HTMLButtonElement>('[data-play-mode]');
    const title = document.getElementById('play-mode-title')!;
    const description = document.getElementById('play-mode-description')!;
    const copy: Record<PlayMode, [string, string]> = {
        computer: ['Play the computer', 'Choose a difficulty, set up your match, and play.'],
        host: ['Play with a friend', 'Set up the match, then share your invitation.'],
        join: ['Join your friend', 'Open an invitation link or enter it below. Your host chooses the match settings.'],
    };
    const select = (mode: PlayMode) => {
        menu.dataset.playMode = mode;
        buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.playMode === mode)));
        [title.textContent, description.textContent] = copy[mode];
    };
    buttons.forEach(button => button.addEventListener('click', () => select(button.dataset.playMode as PlayMode)));
    picker.classList.toggle('hidden', peerGuest);
    select(initial);
    return { select };
}
