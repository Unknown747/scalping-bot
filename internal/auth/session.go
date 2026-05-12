package auth

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"os"
	"sync"
	"time"
)

const (
	cookieName    = "msai_session"
	sessionTTL    = 24 * time.Hour
	maxLoginTries = 5
	lockoutPeriod = 10 * time.Minute
)

type session struct {
	createdAt time.Time
}

type loginAttempt struct {
	count     int
	lockedAt  time.Time
}

type Manager struct {
	mu       sync.RWMutex
	sessions map[string]session

	attemptMu sync.Mutex
	attempts  map[string]*loginAttempt
}

func NewManager() *Manager {
	m := &Manager{
		sessions: make(map[string]session),
		attempts: make(map[string]*loginAttempt),
	}
	go m.cleanupLoop()
	return m
}

func (m *Manager) Validate(username, password string) bool {
	wantUser := os.Getenv("BOT_USERNAME")
	wantPass := os.Getenv("BOT_PASSWORD")
	if wantUser == "" {
		wantUser = "admin"
	}
	if wantPass == "" {
		wantPass = "admin123"
	}
	return username == wantUser && password == wantPass
}

func (m *Manager) IsLockedOut(ip string) bool {
	m.attemptMu.Lock()
	defer m.attemptMu.Unlock()
	a, ok := m.attempts[ip]
	if !ok {
		return false
	}
	if a.count >= maxLoginTries {
		if time.Since(a.lockedAt) < lockoutPeriod {
			return true
		}
		delete(m.attempts, ip)
	}
	return false
}

func (m *Manager) RecordFail(ip string) {
	m.attemptMu.Lock()
	defer m.attemptMu.Unlock()
	a, ok := m.attempts[ip]
	if !ok {
		a = &loginAttempt{}
		m.attempts[ip] = a
	}
	a.count++
	if a.count >= maxLoginTries {
		a.lockedAt = time.Now()
	}
}

func (m *Manager) ResetAttempts(ip string) {
	m.attemptMu.Lock()
	defer m.attemptMu.Unlock()
	delete(m.attempts, ip)
}

func (m *Manager) Create() string {
	b := make([]byte, 32)
	rand.Read(b)
	token := hex.EncodeToString(b)
	m.mu.Lock()
	m.sessions[token] = session{createdAt: time.Now()}
	m.mu.Unlock()
	return token
}

func (m *Manager) IsValid(token string) bool {
	m.mu.RLock()
	s, ok := m.sessions[token]
	m.mu.RUnlock()
	if !ok {
		return false
	}
	if time.Since(s.createdAt) > sessionTTL {
		m.mu.Lock()
		delete(m.sessions, token)
		m.mu.Unlock()
		return false
	}
	return true
}

func (m *Manager) Delete(token string) {
	m.mu.Lock()
	delete(m.sessions, token)
	m.mu.Unlock()
}

func (m *Manager) SetCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(sessionTTL.Seconds()),
	})
}

func (m *Manager) ClearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})
}

func (m *Manager) TokenFromRequest(r *http.Request) string {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return ""
	}
	return c.Value
}

func (m *Manager) IsAuthenticated(r *http.Request) bool {
	return m.IsValid(m.TokenFromRequest(r))
}

func (m *Manager) cleanupLoop() {
	ticker := time.NewTicker(30 * time.Minute)
	for range ticker.C {
		m.mu.Lock()
		for token, s := range m.sessions {
			if time.Since(s.createdAt) > sessionTTL {
				delete(m.sessions, token)
			}
		}
		m.mu.Unlock()
	}
}

func ClientIP(r *http.Request) string {
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	if ip := r.Header.Get("X-Forwarded-For"); ip != "" {
		return ip
	}
	return r.RemoteAddr
}
