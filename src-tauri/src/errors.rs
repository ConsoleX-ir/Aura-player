// One error type for every command. Commands return Result<T, AuraError>;
// serde serializes the `kind` + `message` so the renderer can branch on
// typed failures (the same discipline the provider core uses for network
// errors) instead of string-matching exception text.

#[derive(Debug, thiserror::Error)]
pub enum AuraError {
    #[error("{0}")]
    NotFound(String),

    #[error("{0}")]
    Invalid(String),

    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("provider error: kind={kind} message={message}")]
    Provider { kind: String, message: String },

    #[error("metadata error: {0}")]
    Metadata(String),

    #[error("{0}")]
    Internal(String),
}

impl AuraError {
    pub fn invalid(msg: impl Into<String>) -> Self {
        AuraError::Invalid(msg.into())
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        AuraError::NotFound(msg.into())
    }
    pub fn provider(kind: impl Into<String>, message: impl Into<String>) -> Self {
        AuraError::Provider { kind: kind.into(), message: message.into() }
    }
}

// Tauri commands require the error to impl this trait. Serializing kind +
// message (rather than just the Display string) lets the renderer branch on
// typed failures — the same contract the provider core uses for network
// errors, extended to everything that can cross the IPC boundary.
impl serde::Serialize for AuraError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let kind = match self {
            AuraError::NotFound(_) => "not_found",
            AuraError::Invalid(_) => "invalid",
            AuraError::Database(_) => "database",
            AuraError::Io(_) => "io",
            AuraError::Provider { .. } => "provider",
            AuraError::Metadata(_) => "metadata",
            AuraError::Internal(_) => "internal",
        };
        let mut s = serializer.serialize_struct("AuraError", 2)?;
        s.serialize_field("kind", kind)?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}
