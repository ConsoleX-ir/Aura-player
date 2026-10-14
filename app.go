package main

import "context"

// context_ keeps main.go's hook signatures short.
type context_ = context.Context

// Version is the application version reported to the frontend.
// It is overridden at build time via -ldflags "-X main.Version=...".
var Version = "3.2.0"

// App is the root Wails-bound service (application-level facts only; domain
// services live in internal/...).
type App struct {
	ctx context.Context
}

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context)  { a.ctx = ctx }
func (a *App) shutdown(ctx context.Context) {}

// AppVersion returns the running application version.
func (a *App) AppVersion() string { return Version }
