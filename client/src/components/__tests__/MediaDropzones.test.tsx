import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ArtworkDropzone, AudioDropzone } from '../MediaDropzones';

const png = (size = 2048, name = 'cover.png', type = 'image/png') => new File([new Uint8Array(size)], name, { type });

describe('ArtworkDropzone', () => {
  it('empty state: "Add album art" + "Upload my own"; picking a good image hands it over', () => {
    const onFile = vi.fn();
    render(<ArtworkDropzone imageUrl={null} state="none" seed="Wicked" onFile={onFile} />);
    expect(screen.getByRole('heading', { name: /Add album art/ })).toBeInTheDocument();
    expect(screen.getByTestId('art-preview')).toHaveTextContent('No album art yet');
    expect(screen.getByTestId('art-choose')).toHaveTextContent('Upload my own');
    const file = png();
    fireEvent.change(screen.getByTestId('art-file-input'), { target: { files: [file] } });
    expect(onFile).toHaveBeenCalledWith(file);
    expect(screen.queryByTestId('art-upload-error')).toBeNull();
  });

  it('checks type and size before anything uploads', () => {
    const onFile = vi.fn();
    render(<ArtworkDropzone imageUrl={null} state="none" seed="Wicked" onFile={onFile} />);
    fireEvent.change(screen.getByTestId('art-file-input'), { target: { files: [png(100, 'logo.svg', 'image/svg+xml')] } });
    expect(screen.getByTestId('art-upload-error')).toHaveTextContent('SVG');
    fireEvent.change(screen.getByTestId('art-file-input'), { target: { files: [png(6 * 1024 * 1024)] } });
    expect(screen.getByTestId('art-upload-error')).toHaveTextContent('limit is 5 MB');
    expect(screen.getByTestId('art-choose')).toHaveAttribute('aria-describedby', expect.stringContaining(screen.getByTestId('art-upload-error').id));
    expect(onFile).not.toHaveBeenCalled();
  });

  it('accepts a dropped image and shows the drop hint while dragging', () => {
    const onFile = vi.fn();
    render(<ArtworkDropzone imageUrl={null} state="none" seed="Wicked" onFile={onFile} />);
    const zone = screen.getByTestId('art-dropzone');
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'], files: [] } });
    expect(zone).toHaveClass('is-dragging');
    expect(zone).toHaveTextContent('Drop to use this image');
    const file = png();
    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(zone).not.toHaveClass('is-dragging');
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('offers "Use recording art" / "Remove" / undo only when given, and shows progress with Cancel while busy', () => {
    const onUse = vi.fn();
    const onRemove = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <ArtworkDropzone imageUrl="/uploads/art/u.jpg" state="upload" seed="Wicked" onFile={() => {}} onUseRecording={onUse} onRemove={onRemove} undo={{ label: 'Keep my image', onClick: () => {} }} />,
    );
    expect(screen.getByTestId('art-choose')).toHaveTextContent('Upload a different image');
    fireEvent.click(screen.getByTestId('art-use-recording'));
    fireEvent.click(screen.getByTestId('art-remove'));
    expect(onUse).toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalled();
    expect(screen.getByTestId('art-undo')).toHaveTextContent('Keep my image');

    rerender(<ArtworkDropzone imageUrl={null} state="pending" seed="Wicked" onFile={() => {}} busy={{ label: 'Uploading album art', name: 'cover.png', size: 2048, progress: 0.42 }} onCancel={onCancel} />);
    const bar = screen.getByRole('progressbar', { name: 'Uploading album art cover.png' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByTestId('art-upload-progress')).toHaveTextContent('42%');
    expect(screen.queryByTestId('art-choose')).toBeNull();
    fireEvent.click(screen.getByTestId('art-upload-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('AudioDropzone', () => {
  it('empty: "Add your backing track (no vocals)"; a pending file can be cleared', () => {
    const onFile = vi.fn();
    const onClear = vi.fn();
    const mp3 = new File([new Uint8Array(4096)], 'track.mp3', { type: 'audio/mpeg' });
    const { rerender } = render(<AudioDropzone current={null} onFile={onFile} />);
    expect(screen.getByRole('heading', { name: /Add your backing track \(no vocals\)/ })).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('audio-file-input'), { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });
    expect(screen.getByTestId('audio-upload-error')).toHaveTextContent('audio file');
    fireEvent.change(screen.getByTestId('audio-file-input'), { target: { files: [mp3] } });
    expect(onFile).toHaveBeenCalledWith(mp3);
    expect(screen.queryByTestId('audio-upload-error')).toBeNull();

    rerender(<AudioDropzone current={null} pending={mp3} onClearPending={onClear} onFile={onFile} />);
    expect(screen.getByTestId('audio-pending')).toHaveTextContent('track.mp3');
    expect(screen.getByTestId('audio-pending')).toHaveTextContent('uploads when you save');
    fireEvent.click(screen.getByRole('button', { name: 'Don’t upload track.mp3' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('an uploaded track: remove, and undo while it is only marked for removal', () => {
    const onRemove = vi.fn();
    const onUndo = vi.fn();
    const { rerender } = render(<AudioDropzone current={{ label: 'A backing track is uploaded.' }} onFile={() => {}} onRemove={onRemove} />);
    expect(screen.getByRole('heading', { name: /Your backing track/ })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('audio-remove'));
    expect(onRemove).toHaveBeenCalled();
    rerender(<AudioDropzone current={{ label: 'x' }} markedForRemoval onUndoRemove={onUndo} onFile={() => {}} onRemove={onRemove} />);
    expect(screen.getByText('The uploaded track will be removed when you save.')).toBeInTheDocument();
    expect(screen.queryByTestId('audio-remove')).toBeNull();
    fireEvent.click(screen.getByTestId('audio-undo'));
    expect(onUndo).toHaveBeenCalled();
  });

  it('indeterminate progress (e.g. removing) has no value', () => {
    render(<AudioDropzone current={null} onFile={() => {}} busy={{ label: 'Removing the uploaded track', progress: null }} />);
    expect(screen.getByRole('progressbar', { name: 'Removing the uploaded track' })).not.toHaveAttribute('aria-valuenow');
  });
});
