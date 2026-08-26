import { describe, expect, it, vi } from 'vitest';
import { mountMascot } from '../../entrypoints/launcher.content';

describe('小虎懸浮球', () => {
  it('點一下共用切換流程並反映開關狀態', async () => {
    const toggle = vi.fn().mockResolvedValue(true);
    const mascot = mountMascot(toggle, '/icon.png');

    mascot.button.click();

    await vi.waitFor(() => expect(mascot.button.ariaPressed).toBe('true'));
    expect(toggle).toHaveBeenCalledOnce();
    expect(mascot.button.ariaLabel).toContain('關閉');
    mascot.destroy();
  });

  it('拖曳時跟著指標移動且不誤觸切換', () => {
    const toggle = vi.fn().mockResolvedValue(true);
    const mascot = mountMascot(toggle, '/icon.png');
    mascot.host.getBoundingClientRect = () => ({
      x: 100, y: 100, left: 100, top: 100, right: 150, bottom: 150,
      width: 50, height: 50, toJSON: () => ({}),
    });
    mascot.button.setPointerCapture = vi.fn();

    mascot.button.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 120, clientY: 120,
    }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 180, clientY: 190 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 180, clientY: 190 }));
    mascot.button.click();

    expect(mascot.host.style.left).toBe('160px');
    expect(mascot.host.style.top).toBe('170px');
    expect(toggle).not.toHaveBeenCalled();
    mascot.destroy();
  });
});
