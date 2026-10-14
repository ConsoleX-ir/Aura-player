module github.com/ConsoleX-ir/aura-player

go 1.25.0

require (
	github.com/wailsapp/wails/v2 v2.14.0
	golang.org/x/sys v0.46.0
)

require (
	git.sr.ht/~jackmordaunt/go-toast/v2 v2.0.3 // indirect
	github.com/bep/debounce v1.2.1 // indirect
	github.com/go-ole/go-ole v1.3.0 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/leaanthony/go-ansi-parser v1.6.1 // indirect
	github.com/leaanthony/gosod v1.0.4 // indirect
	github.com/leaanthony/slicer v1.6.0 // indirect
	github.com/leaanthony/u v1.1.1 // indirect
	github.com/pkg/browser v0.0.0-20240102092130-5ac0b6a4141c // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/rivo/uniseg v0.4.7 // indirect
	github.com/samber/lo v1.49.1 // indirect
	github.com/tkrajina/go-reflector v0.5.8 // indirect
	github.com/wailsapp/go-webview2 v1.0.22 // indirect
	github.com/wailsapp/mimetype v1.4.1 // indirect
	golang.org/x/net v0.56.0 // indirect
	golang.org/x/text v0.39.0 // indirect
)

// ---- SANDBOX-ONLY overlay (use: GOFLAGS=-modfile=go.sandbox.mod). Not for releases. ----
replace golang.org/x/mod => github.com/golang/mod v0.37.0

replace golang.org/x/net => github.com/golang/net v0.56.0

replace golang.org/x/sys => github.com/golang/sys v0.46.0

replace golang.org/x/tools => github.com/golang/tools v0.47.0

replace golang.org/x/crypto => github.com/golang/crypto v0.53.0

replace golang.org/x/image => github.com/golang/image v0.41.0

replace golang.org/x/sync => github.com/golang/sync v0.21.0

replace golang.org/x/term => github.com/golang/term v0.44.0

replace golang.org/x/text => github.com/golang/text v0.39.0

replace golang.org/x/telemetry => github.com/golang/telemetry v0.0.0-20260625142307-59b4966ccb57

replace gopkg.in/yaml.v3 => github.com/go-yaml/yaml/v3 v3.0.1

replace gopkg.in/check.v1 => github.com/go-check/check v0.0.0-20201130134442-10cb98267c6c

replace gopkg.in/warnings.v0 => github.com/go-warnings/warnings v0.1.2

replace atomicgo.dev/cursor => github.com/atomicgo/cursor v0.2.0

replace atomicgo.dev/keyboard => github.com/atomicgo/keyboard v0.2.9

replace atomicgo.dev/schedule => github.com/atomicgo/schedule v0.1.0

replace dario.cat/mergo => github.com/darccio/mergo v1.0.0

replace git.sr.ht/~jackmordaunt/go-toast/v2 => /home/claude/sandbox-stubs/go-toast
