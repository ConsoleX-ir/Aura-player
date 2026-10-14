package lifecycle

import (
	"sync/atomic"
	"testing"
	"time"
)

func newSvc(timeout time.Duration) (*Service, *atomic.Int32, *atomic.Int32) {
	var emits, quits atomic.Int32
	return New(func() { emits.Add(1) }, func() { quits.Add(1) }, timeout), &emits, &quits
}

func TestFirstCloseIsHeldAndFlushRequestedOnce(t *testing.T) {
	s, emits, quits := newSvc(time.Hour)
	if !s.BeforeClose() {
		t.Fatal("first close must be vetoed")
	}
	if !s.BeforeClose() { // user presses X again while the flush is in flight
		t.Fatal("second close during flush must still be vetoed")
	}
	if emits.Load() != 1 {
		t.Errorf("flush requested %d times, want 1", emits.Load())
	}
	if quits.Load() != 0 {
		t.Error("must not quit before the ack")
	}
}

func TestAckLetsCloseProceed(t *testing.T) {
	s, _, quits := newSvc(time.Hour)
	s.BeforeClose()
	s.NotifyShutdownComplete()
	if quits.Load() != 1 {
		t.Fatalf("quits = %d, want 1", quits.Load())
	}
	if s.BeforeClose() {
		t.Error("after the flush, the re-issued close must not be vetoed")
	}
}

func TestTimeoutForcesQuitWhenRendererNeverAcks(t *testing.T) {
	s, _, quits := newSvc(20 * time.Millisecond)
	s.BeforeClose()
	deadline := time.Now().Add(2 * time.Second)
	for quits.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if quits.Load() != 1 {
		t.Fatalf("hung renderer blocked quitting (quits=%d)", quits.Load())
	}
}

func TestLateAckAfterTimeoutDoesNotDoubleQuit(t *testing.T) {
	s, _, quits := newSvc(10 * time.Millisecond)
	s.BeforeClose()
	time.Sleep(60 * time.Millisecond)
	s.NotifyShutdownComplete()
	if quits.Load() != 1 {
		t.Errorf("quits = %d, want exactly 1", quits.Load())
	}
}

func TestAckWithoutPendingCloseIsIgnored(t *testing.T) {
	s, _, quits := newSvc(time.Hour)
	s.NotifyShutdownComplete() // e.g. a stray renderer message
	if quits.Load() != 0 {
		t.Error("a stray ack must not quit the app")
	}
}
