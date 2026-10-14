package dialogs

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// WailsBackend implements Backend with the Wails runtime dialogs.
type WailsBackend struct{}

func toWails(fs []Filter) []runtime.FileFilter {
	out := make([]runtime.FileFilter, len(fs))
	for i, f := range fs {
		out[i] = runtime.FileFilter{DisplayName: f.Name, Pattern: f.Pattern}
	}
	return out
}

func (WailsBackend) OpenDirectory(ctx context.Context, title string) (string, error) {
	return runtime.OpenDirectoryDialog(ctx, runtime.OpenDialogOptions{Title: title})
}

func (WailsBackend) OpenFiles(ctx context.Context, title string, filters []Filter) ([]string, error) {
	return runtime.OpenMultipleFilesDialog(ctx, runtime.OpenDialogOptions{Title: title, Filters: toWails(filters)})
}

func (WailsBackend) SaveFile(ctx context.Context, title, defaultName string, filters []Filter) (string, error) {
	return runtime.SaveFileDialog(ctx, runtime.SaveDialogOptions{Title: title, DefaultFilename: defaultName, Filters: toWails(filters)})
}
