# Database relationship evidence for the mobile privacy/deletion audit

Generated from source on 2026-10-12 using scripts/audit-mobile-data-schema.mjs.
Found 62 pgTable definitions. No database connection, environment values or user data were accessed.

## Scope and limits

- This is a relationship inventory, not a finished deletion policy or proof of actual database constraints.
- “User-associated” includes indirect/shared relationships; it does not mean an entire table or every related row belongs exclusively to one user.
- Listed onDelete behavior is from source only. Compare migrations and the target database before relying on it.
- Foreign-key-free IDs, JSON, arrays, object storage, email, calendars, AI processors, local native/extension memory, logs and backups require additional review.
- Do not cascade-delete public employer/source catalogues or another person's applications or messages merely because a path reaches them.
- Retention durations, legal exceptions, backup timing and processor erasure are UNRESOLVED pending owner/provider/legal confirmation. No duration is inferred.
- An export must use explicit field allowlists and ownership joins; never export passwords, session material, email-verification/reset tokens, OAuth credentials or internal administrative notes.
- The review candidates below are conservative name/type heuristics, not proven ownership, a deletion allowlist or an exhaustive personal-data detector. Unflagged free text can also contain personal data.

## Non-FK and container review candidates

| Table | Column | Why manual review is required |
| --- | --- | --- |
| job_alert_vacancy_deliveries | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| applications | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| applications | cvDocumentId | possible document/object pointer — resolve ownership and copies before deleting references |
| applications | jobsageEmail | possible direct personal/contact metadata — not necessarily exclusive ownership |
| audit_events | actor | possible account/actor/indirect ownership selector — verify writes and role semantics |
| audit_events | details | JSON container — inspect nested identities, personal data and credentials |
| user_sessions | sess | JSON container — inspect nested identities, personal data and credentials |
| users | email | possible direct personal/contact metadata — not necessarily exclusive ownership |
| users | firstName | possible direct personal/contact metadata — not necessarily exclusive ownership |
| users | lastName | possible direct personal/contact metadata — not necessarily exclusive ownership |
| users | profileImageUrl | possible document/object pointer — resolve ownership and copies before deleting references |
| users | googleCalendarRefreshToken | credential-like field — never presume exportable; verify purpose |
| users | googleCalendarAccountEmail | possible direct personal/contact metadata — not necessarily exclusive ownership |
| users | passwordHash | credential-like field — never presume exportable; verify purpose |
| users | emailVerified | possible direct personal/contact metadata — not necessarily exclusive ownership |
| users | emailVerifyToken | possible direct personal/contact metadata — not necessarily exclusive ownership; credential-like field — never presume exportable; verify purpose |
| users | emailVerifyTokenExpires | possible direct personal/contact metadata — not necessarily exclusive ownership; credential-like field — never presume exportable; verify purpose |
| users | passwordResetToken | credential-like field — never presume exportable; verify purpose |
| users | passwordResetTokenExpires | credential-like field — never presume exportable; verify purpose |
| users | jobsageEmail | possible direct personal/contact metadata — not necessarily exclusive ownership |
| candidate_badges | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| candidate_match_scores | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| match_dismissals | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| candidate_messages | senderEmployerProfileId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| candidate_messages | recipientUserId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| candidate_messages | senderEmail | possible direct personal/contact metadata — not necessarily exclusive ownership |
| career_profiles | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| career_profiles | aiCvSourceDocumentId | possible document/object pointer — resolve ownership and copies before deleting references |
| consent_logs | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| consent_logs | ipHash | possible direct personal/contact metadata — not necessarily exclusive ownership |
| cv_enhancement_usage | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| documents | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| documents | storageKey | possible document/object pointer — resolve ownership and copies before deleting references |
| documents | parsedData | JSON container — inspect nested identities, personal data and credentials |
| employer_profiles | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| employer_profiles | contactEmail | possible direct personal/contact metadata — not necessarily exclusive ownership |
| employer_profiles | contactPhone | possible direct personal/contact metadata — not necessarily exclusive ownership |
| job_listings | employerProfileId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| job_listings | targetProfessions | JSON container — inspect nested identities, personal data and credentials |
| job_listings | targetRegions | JSON container — inspect nested identities, personal data and credentials |
| employer_description_feedback | employerUserId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| feedback | email | possible direct personal/contact metadata — not necessarily exclusive ownership |
| feedback | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| feedback | userAgent | possible direct personal/contact metadata — not necessarily exclusive ownership |
| feedback | reviewedBy | possible account/actor/indirect ownership selector — verify writes and role semantics |
| feedback_replies | adminUserId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| feedback_replies | adminDisplayName | possible direct personal/contact metadata — not necessarily exclusive ownership |
| headhunt_campaigns | employerProfileId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| headhunt_campaigns | filters | JSON container — inspect nested identities, personal data and credentials |
| identity_verifications | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| identity_verifications | passportKey | possible document/object pointer — resolve ownership and copies before deleting references |
| identity_verifications | selfieKey | possible document/object pointer — resolve ownership and copies before deleting references |
| learning_videos | storageKey | possible document/object pointer — resolve ownership and copies before deleting references |
| learning_videos | reviewedBy | possible account/actor/indirect ownership selector — verify writes and role semantics |
| learning_videos | createdBy | possible account/actor/indirect ownership selector — verify writes and role semantics |
| learning_videos | updatedBy | possible account/actor/indirect ownership selector — verify writes and role semantics |
| marketer_events | marketingUserId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| marketer_events | externalInviteeEmail | possible direct personal/contact metadata — not necessarily exclusive ownership |
| message_sender_blocks | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| nhs_vacancy_outage_backoffs | probeToken | credential-like field — never presume exportable; verify purpose |
| profiles | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| profiles | preferredRegion | array container — inspect element ownership and shared values |
| profiles | languages | array container — inspect element ownership and shared values |
| profiles | phone | possible direct personal/contact metadata — not necessarily exclusive ownership |
| profiles | jobsageEmail | possible direct personal/contact metadata — not necessarily exclusive ownership |
| candidate_readiness_claims | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| recommendation_letters | candidateUserId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| recommendation_letters | employerUserId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| remediation_plans | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| remediation_plans | orderedStepIds | JSON container — inspect nested identities, personal data and credentials |
| review_cases | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| review_cases | reviewedBy | possible account/actor/indirect ownership selector — verify writes and role semantics |
| roles | targetRegions | JSON container — inspect nested identities, personal data and credentials |
| roles | contactEmail | possible direct personal/contact metadata — not necessarily exclusive ownership |
| roles | contactPhone | possible direct personal/contact metadata — not necessarily exclusive ownership |
| role_gap_analyses | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| role_gap_analyses | matchedRequirements | JSON container — inspect nested identities, personal data and credentials |
| role_gap_analyses | gaps | JSON container — inspect nested identities, personal data and credentials |
| role_gap_analyses | optimizationSteps | JSON container — inspect nested identities, personal data and credentials |
| rulesets | createdBy | possible account/actor/indirect ownership selector — verify writes and role semantics |
| ruleset_rules | conditions | JSON container — inspect nested identities, personal data and credentials |
| ruleset_rules | pathways | JSON container — inspect nested identities, personal data and credentials |
| decision_records | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| decision_records | reasonCodes | JSON container — inspect nested identities, personal data and credentials |
| decision_records | pathways | JSON container — inspect nested identities, personal data and credentials |
| smart_apply_drafts | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| smart_apply_drafts | answers | JSON container — inspect nested identities, personal data and credentials |
| social_leads | firstName | possible direct personal/contact metadata — not necessarily exclusive ownership |
| social_leads | lastName | possible direct personal/contact metadata — not necessarily exclusive ownership |
| social_leads | email | possible direct personal/contact metadata — not necessarily exclusive ownership |
| social_leads | phone | possible direct personal/contact metadata — not necessarily exclusive ownership |
| social_leads | ipHash | possible direct personal/contact metadata — not necessarily exclusive ownership |
| social_leads | convertedUserId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| social_leads | marketingUserId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| speculative_applications | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| speculative_applications | cvDocumentId | possible document/object pointer — resolve ownership and copies before deleting references |
| speculative_applications | coverLetterDocumentId | possible document/object pointer — resolve ownership and copies before deleting references |
| speculative_applications | emailSent | possible direct personal/contact metadata — not necessarily exclusive ownership |
| speculative_applications | emailSentAt | possible direct personal/contact metadata — not necessarily exclusive ownership |
| speculative_applications | emailRecipient | possible direct personal/contact metadata — not necessarily exclusive ownership |
| speculative_applications | jobsageEmail | possible direct personal/contact metadata — not necessarily exclusive ownership |
| speculative_application_delivery_attempts | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| sponsor_licence_url_migration_staging | identitySnapshot | JSON container — inspect nested identities, personal data and credentials |
| sponsor_licence_url_migration_staging | candidateSnapshot | JSON container — inspect nested identities, personal data and credentials |
| sponsor_licence_url_migration_staging | productionCandidates | JSON container — inspect nested identities, personal data and credentials |
| sponsor_licence_website_enrichment_audits | classifications | JSON container — inspect nested identities, personal data and credentials |
| sponsor_licence_website_enrichment_audits | candidateResults | JSON container — inspect nested identities, personal data and credentials |
| sponsor_licence_website_enrichment_audits | searchQueries | JSON container — inspect nested identities, personal data and credentials |
| sponsor_licences | contactEmail | possible direct personal/contact metadata — not necessarily exclusive ownership |
| sponsor_licences | contactPhone | possible direct personal/contact metadata — not necessarily exclusive ownership |
| sponsor_licence_identity_crosswalk | identitySnapshot | JSON container — inspect nested identities, personal data and credentials |
| vacancy_sync_log | metrics | JSON container — inspect nested identities, personal data and credentials |
| sponsor_licence_vacancy_checks | vacancyList | JSON container — inspect nested identities, personal data and credentials |
| sponsor_licence_company_site_checks | crawlLeaseToken | credential-like field — never presume exportable; verify purpose |
| sponsor_licence_company_site_checks | crawlState | JSON container — inspect nested identities, personal data and credentials |
| sponsor_licence_contact_enrichments | contactEmail | possible direct personal/contact metadata — not necessarily exclusive ownership |
| company_site_host_states | requestLeaseToken | credential-like field — never presume exportable; verify purpose |
| sponsor_licence_vacancies | targetRegions | JSON container — inspect nested identities, personal data and credentials |
| sponsor_licence_vacancies | companyVacancyEvidence | JSON container — inspect nested identities, personal data and credentials |
| sponsor_licence_vacancies | sourceMetadata | JSON container — inspect nested identities, personal data and credentials |
| sponsor_licence_bookmarks | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| sponsor_licence_vacancy_scores | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| sponsor_licence_vacancy_scores | missingRequirements | JSON container — inspect nested identities, personal data and credentials |
| sponsor_licence_gap_analyses | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| sponsor_licence_gap_analyses | matchedRequirements | JSON container — inspect nested identities, personal data and credentials |
| sponsor_licence_gap_analyses | gaps | JSON container — inspect nested identities, personal data and credentials |
| sponsor_licence_gap_analyses | optimizationSteps | JSON container — inspect nested identities, personal data and credentials |
| support_tickets | email | possible direct personal/contact metadata — not necessarily exclusive ownership |
| support_tickets | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| support_tickets | reviewedBy | possible account/actor/indirect ownership selector — verify writes and role semantics |
| support_ticket_replies | adminUserId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| support_ticket_replies | adminDisplayName | possible direct personal/contact metadata — not necessarily exclusive ownership |
| vacancy_favorites | userId | possible account/actor/indirect ownership selector — verify writes and role semantics |
| vacancy_source_observations | sourceMetadata | JSON container — inspect nested identities, personal data and credentials |

## Source relationships

| Table / definition | User-associated through declared FK graph | Columns | Declared references and deletion action |
| --- | --- | --- | --- |
| job_alert_vacancy_deliveries (jobAlertVacancyDeliveriesTable), [source](../../lib/db/src/schema/alertDeliveries.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, vacancyId, vacancyUrl, sentAt | No inline FK declaration |
| applications (applicationsTable), [source](../../lib/db/src/schema/applications.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, roleId, applicationType, applicationUrl, companyName, jobTitle, status, appliedAt, notes, interviewDate, interviewNotes, cvDocumentId, jobsageEmail | No inline FK declaration |
| audit_events (auditEventsTable), [source](../../lib/db/src/schema/audit.ts) | Not established by graph; inspect raw identifiers/JSON | id, actor, action, target, details, createdAt | No inline FK declaration |
| user_sessions (sessionsTable), [source](../../lib/db/src/schema/auth.ts) | Not established by graph; inspect raw identifiers/JSON | sid, sess, expire | No inline FK declaration |
| users (usersTable), [source](../../lib/db/src/schema/auth.ts) | Yes — ownership and sharing need review | id, email, firstName, lastName, profileImageUrl, calendlyUrl, googleBookingSlug, googleBookingEnabled, googleBookingTimezone, googleCalendarRefreshToken, googleCalendarAccountEmail, googleCalendarConnectedAt, role, plan, bonusReadinessChecks, subscriptionExpiresAt, readinessQuotaResetAt, stripeCustomerId, stripePaymentIntentId, passwordHash, emailVerified, emailVerifyToken, emailVerifyTokenExpires, passwordResetToken, passwordResetTokenExpires, suspendedAt, jobsageEmail, createdAt, updatedAt | No inline FK declaration |
| candidate_badges (candidateBadgesTable), [source](../../lib/db/src/schema/badges.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, badgeKey, awardedAt | No inline FK declaration |
| candidate_match_scores (candidateMatchScoresTable), [source](../../lib/db/src/schema/candidateMatchScores.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, roleId, score, aiExplanation, scoredAt | No inline FK declaration |
| match_dismissals (matchDismissalsTable), [source](../../lib/db/src/schema/candidateMatchScores.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, roleId, dismissedAt | No inline FK declaration |
| candidate_messages (candidateMessagesTable), [source](../../lib/db/src/schema/candidateMessages.ts) | Yes — ownership and sharing need review | id, senderEmployerProfileId, recipientUserId, vacancyId, applicationId, supportTicketId, messageType, messageText, subject, isRead, archivedAt, createdAt, companyName, senderEmail, externalMessageId | supportTicketId → supportTicketsTable; "set null" |
| career_profiles (careerProfilesTable), [source](../../lib/db/src/schema/careerProfiles.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, name, focusArea, aiCvContent, aiCvReviewedAt, aiCvSourceDocumentId, isActive, createdAt, updatedAt | No inline FK declaration |
| consent_logs (consentLogsTable), [source](../../lib/db/src/schema/consent.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, termsVersion, ipHash, consentedAt | No inline FK declaration |
| cv_enhancement_usage (cvEnhancementUsageTable), [source](../../lib/db/src/schema/cvEnhancementUsage.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, usageDate, count | No inline FK declaration |
| documents (documentsTable), [source](../../lib/db/src/schema/documents.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, filename, mimeType, storageKey, fileSize, documentType, label, isPrimary, disclaimerText, parsedData, uploadedAt | No inline FK declaration |
| employer_profiles (employerProfilesTable), [source](../../lib/db/src/schema/employer.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, companyName, industry, sponsorLicenceNumber, region, contactEmail, contactPhone, contactWebsite, createdAt, updatedAt | No inline FK declaration |
| job_listings (jobListingsTable), [source](../../lib/db/src/schema/employer.ts) | Not established by graph; inspect raw identifiers/JSON | id, employerProfileId, title, specialty, location, salaryBand, sponsorshipOffered, requirements, description, status, regulator, requiredRegistration, requiredDbsClearanceLevel, requiredSafeguardingLevel, targetProfessions, targetRegions, applyUrl, liveness, lastVerifiedAt, livenessReason, createdAt, updatedAt | No inline FK declaration |
| employer_description_feedback (employerDescriptionFeedbackTable), [source](../../lib/db/src/schema/employerDescriptionFeedback.ts) | Yes — ownership and sharing need review | id, employerUserId, sentiment, jobTitle, specialty, createdAt | employerUserId → usersTable; "set null" |
| feedback (feedbackTable), [source](../../lib/db/src/schema/feedback.ts) | Yes — ownership and sharing need review | id, category, message, email, pageUrl, screenResolution, userId, userAgent, status, adminNotes, reviewedBy, reviewedAt, createdAt, updatedAt | userId → usersTable; "set null"<br>reviewedBy → usersTable; "set null" |
| feedback_replies (feedbackRepliesTable), [source](../../lib/db/src/schema/feedbackReplies.ts) | Yes — ownership and sharing need review | id, feedbackId, adminUserId, adminDisplayName, replyText, deliveryChannel, deliveryStatus, candidateMessageId, createdAt | feedbackId → feedbackTable; "cascade"<br>candidateMessageId → candidateMessagesTable; "set null" |
| headhunt_campaigns (headhuntCampaignsTable), [source](../../lib/db/src/schema/headhuntCampaigns.ts) | Not established by graph; inspect raw identifiers/JSON | id, employerProfileId, vacancyId, name, filters, createdAt, lastRunAt | No inline FK declaration |
| identity_verifications (identityVerificationsTable), [source](../../lib/db/src/schema/identityVerifications.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, passportKey, selfieKey, status, aiConfidence, aiNotes, adminNotes, verifiedAt, createdAt, updatedAt | No inline FK declaration |
| learning_videos (learningVideosTable), [source](../../lib/db/src/schema/learningVideos.ts) | Yes — ownership and sharing need review | id, title, description, category, videoEmbedUrl, storageKey, durationSeconds, language, applicability, sourceLabel, sourceUrl, transcript, reviewedBy, reviewedAt, reviewDueAt, status, sortOrder, createdBy, updatedBy, createdAt, updatedAt | createdBy → usersTable; "restrict"<br>updatedBy → usersTable; "set null" |
| marketer_events (marketerEventsTable), [source](../../lib/db/src/schema/marketerEvents.ts) | Yes — ownership and sharing need review | id, marketingUserId, leadId, title, scheduledAt, endTime, meetingUrl, status, notes, source, externalEventUri, externalInviteeUri, externalInviteeEmail, calendlySyncedAt, googleSyncedAt, createdAt | marketingUserId → usersTable; "cascade"<br>leadId → socialLeadsTable; "set null" |
| message_sender_blocks (messageSenderBlocksTable), [source](../../lib/db/src/schema/messageSenderBlocks.ts) | Yes — ownership and sharing need review | id, userId, senderKey, senderLabel, createdAt | userId → usersTable; "cascade" |
| nhs_vacancy_outage_backoffs (nhsVacancyOutageBackoffsTable), [source](../../lib/db/src/schema/nhsVacancyOutageBackoffs.ts) | Not established by graph; inspect raw identifiers/JSON | id, organisationKey, probeToken, probeLeaseUntil, retryAfter, updatedAt | No inline FK declaration |
| profiles (profilesTable), [source](../../lib/db/src/schema/profiles.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, profession, sector, specialty, qualificationCountry, qualificationType, qualificationYear, experienceYears, registrationStatus, licenceReady, dbsClearanceLevel, safeguardingTrainingLevel, residencyStatus, requiresSponsorship, preferredRegion, alertFrequency, lastAlertSentAt, boostProfile, preferredStartDate, profilePhotoKey, languages, additionalNotes, applicationMotivation, applicationStrengths, noticePeriod, startAvailability, phone, streetAddress, city, postcode, country, jobsageEmail, createdAt, updatedAt | No inline FK declaration |
| candidate_readiness_claims (candidateReadinessClaimsTable), [source](../../lib/db/src/schema/readinessClaims.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, claimKey, claimText, sourceRoleId, sourceVacancyId, createdAt, updatedAt | No inline FK declaration |
| recommendation_letters (recommendationLettersTable), [source](../../lib/db/src/schema/recommendationLetters.ts) | Not established by graph; inspect raw identifiers/JSON | id, candidateUserId, employerUserId, authorName, authorTitle, organisation, relationship, content, isEmployerVerified, createdAt | No inline FK declaration |
| remediation_plans (remediationPlansTable), [source](../../lib/db/src/schema/remediation.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, decisionRecordId, orderedStepIds, createdAt | decisionRecordId → decisionRecordsTable; "cascade" |
| remediation_steps (remediationStepsTable), [source](../../lib/db/src/schema/remediation.ts) | Not established by graph; inspect raw identifiers/JSON | id, planId, stepOrder, title, description, gap, timelineRange, costRange, pathway, stepSource, ruleId, rulesetVersion, status, updatedAt | planId → remediationPlansTable; "cascade" |
| review_cases (reviewCasesTable), [source](../../lib/db/src/schema/review.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, decisionRecordId, flagReason, status, reviewedBy, reviewedAt, createdAt | decisionRecordId → decisionRecordsTable; "cascade" |
| review_annotations (reviewAnnotationsTable), [source](../../lib/db/src/schema/review.ts) | Not established by graph; inspect raw identifiers/JSON | id, caseId, reviewerId, notes, recommendedPathway, createdAt | caseId → reviewCasesTable; "cascade" |
| roles (rolesTable), [source](../../lib/db/src/schema/roles.ts) | Not established by graph; inspect raw identifiers/JSON | id, title, employer, location, regulator, sponsorshipOffered, requiredRegistration, requiredDbsClearanceLevel, requiredSafeguardingLevel, targetRegions, active, importedAt, importedBy, applyUrl, contactEmail, contactPhone, contactWebsite, liveness, lastVerifiedAt, livenessReason | No inline FK declaration |
| role_gap_analyses (roleGapAnalysesTable), [source](../../lib/db/src/schema/roles.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, roleId, matchedRequirements, gaps, optimizationSteps, generatedAt | No inline FK declaration |
| rulesets (rulesetsTable), [source](../../lib/db/src/schema/rulesets.ts) | Not established by graph; inspect raw identifiers/JSON | id, regulator, version, status, effectiveDate, changelog, createdBy, createdAt | No inline FK declaration |
| ruleset_rules (rulesetRulesTable), [source](../../lib/db/src/schema/rulesets.ts) | Not established by graph; inspect raw identifiers/JSON | id, rulesetId, ruleKey, conditions, outcome, reasonCode, explanationText, pathways, sortOrder | rulesetId → rulesetsTable; "cascade" |
| decision_records (decisionRecordsTable), [source](../../lib/db/src/schema/rulesets.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, profileSnapshotHash, rulesetId, rulesetVersion, outcome, reasonCodes, explanationText, pathways, reviewFlagged, reviewNote, createdAt | rulesetId → rulesetsTable; NO ACTION (no explicit onDelete) |
| smart_apply_drafts (smartApplyDraftsTable), [source](../../lib/db/src/schema/smartApplyDrafts.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, roleId, answers, updatedAt | No inline FK declaration |
| social_leads (socialLeadsTable), [source](../../lib/db/src/schema/socialLeads.ts) | Yes — ownership and sharing need review | id, firstName, lastName, email, phone, industrySector, desiredRole, additionalMessage, utmSource, utmMedium, utmCampaign, utmContent, landingPath, referrerUrl, ipHash, gdprConsent, gdprConsentedAt, status, source, convertedUserId, marketingUserId, claimedAt, contactedAt, waitlistConfirmationSentAt, waitlistConfirmationProviderId, waitlistConfirmationLastError, createdAt | marketingUserId → usersTable; "set null" |
| speculative_applications (speculativeApplicationsTable), [source](../../lib/db/src/schema/speculativeApplications.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, companyName, sponsorLicenceId, status, notes, cvDocumentId, coverLetterDocumentId, coverLetterFilename, coverLetterIncluded, vacancyRef, roleId, vacancyUrl, sourceType, boardName, emailSent, emailSentAt, emailRecipient, jobsageEmail, vacancyTitle, deliveryStatus, deliveryError, deliveryAttempts, lastDeliveryAttemptAt, attachmentType, deliveryRoute, createdAt | No inline FK declaration |
| speculative_application_delivery_attempts (speculativeApplicationDeliveryAttemptsTable), [source](../../lib/db/src/schema/speculativeApplications.ts) | Not established by graph; inspect raw identifiers/JSON | id, speculativeApplicationId, userId, outcome, attemptedAt, completedAt, error | No inline FK declaration |
| sponsor_licence_url_migration_staging (sponsorLicenceUrlMigrationStagingTable), [source](../../lib/db/src/schema/sponsorLicenceUrlMigrationStaging.ts) | Not established by graph; inspect raw identifiers/JSON | id, sourceSystem, sourceRef, candidateHash, field, organisationName, candidateUrl, evidenceUrl, identitySnapshot, candidateSnapshot, productionCandidates, resolverStatus, resolverReason, reviewStatus, stagedBy, createdAt, updatedAt | No inline FK declaration |
| sponsor_licence_website_enrichment_audits (sponsorLicenceWebsiteEnrichmentAuditsTable), [source](../../lib/db/src/schema/sponsorLicenceWebsiteEnrichmentAudits.ts) | Not established by graph; inspect raw identifiers/JSON | id, runId, organisationKey, organisationName, sampleGroup, sector, townCity, existingWebsiteUrl, existingCareersUrl, websiteUrl, websiteConfidence, websiteEvidenceUrl, careersUrl, careersConfidence, careersEvidenceUrl, atsProvider, atsBoardId, atsMappingStatus, atsMappingEvidenceUrl, classifications, candidateResults, searchQueries, checkedAt, lastError, createdAt, updatedAt | No inline FK declaration |
| sponsor_licences (sponsorLicencesTable), [source](../../lib/db/src/schema/sponsorLicences.ts) | Not established by graph; inspect raw identifiers/JSON | id, organisationName, townCity, county, route, subRoute, rating, industry, syncedAt, website, websiteOdsCode, websiteOdsRecordUrl, contactEmail, contactPhone, address, region, contactBackfillAttemptedAt | No inline FK declaration |
| sponsor_licence_identity_crosswalk (sponsorLicenceIdentityCrosswalkTable), [source](../../lib/db/src/schema/sponsorLicences.ts) | Not established by graph; inspect raw identifiers/JSON | id, sourceSystem, identityKey, identitySnapshot, targetSponsorLicenceId, resolutionMethod, resolvedBy, createdAt, updatedAt | targetSponsorLicenceId → sponsorLicencesTable; "cascade" |
| sponsor_licence_sync_log (sponsorLicenceSyncLogTable), [source](../../lib/db/src/schema/sponsorLicences.ts) | Not established by graph; inspect raw identifiers/JSON | id, status, recordCount, addedCount, updatedCount, removedCount, durationMs, triggeredBy, errorMessage, createdAt | No inline FK declaration |
| vacancy_sync_log (vacancySyncLogTable), [source](../../lib/db/src/schema/sponsorLicences.ts) | Not established by graph; inspect raw identifiers/JSON | id, status, batchSize, checkedCount, cacheHitCount, errorCount, errorMessage, triggeredBy, durationMs, jobKind, metrics, createdAt | No inline FK declaration |
| sponsor_licence_vacancy_checks (sponsorLicenceVacancyChecksTable), [source](../../lib/db/src/schema/sponsorLicences.ts) | Not established by graph; inspect raw identifiers/JSON | id, organisationName, checkedAt, vacanciesFound, vacancyCount, sourceUrl, summary, vacancyList | No inline FK declaration |
| sponsor_licence_company_site_checks (sponsorLicenceCompanySiteChecksTable), [source](../../lib/db/src/schema/sponsorLicences.ts) | Not established by graph; inspect raw identifiers/JSON | id, organisationName, genericCheckedAt, atsCheckedAt, careersUrl, atsProvider, atsBoardId, atsMappingEvidenceUrl, atsMappingStatus, retryAfter, lastError, lastAttemptedAt, lastCompletedAt, lastPartialAt, lastOutcome, probeStatus, lastProbedAt, probeReason, lastPagesFetched, lastAdvertsFound, lastRejectedCount, crawlLeaseUntil, crawlLeaseToken, crawlState, createdAt, updatedAt | No inline FK declaration |
| sponsor_licence_contact_enrichments (sponsorLicenceContactEnrichmentsTable), [source](../../lib/db/src/schema/sponsorLicences.ts) | Not established by graph; inspect raw identifiers/JSON | id, organisationName, stage, status, attempts, retryAfter, websiteUrl, websiteLookupSource, websiteLookupAt, websiteCitedAt, websiteVerifiedAt, websiteEvidenceUrl, contactEmail, contactSource, contactEvidenceUrl, contactExtractedAt, storedHarvestedAt, lastError, createdAt, updatedAt, completedAt | No inline FK declaration |
| contact_web_search_usage (contactWebSearchUsageTable), [source](../../lib/db/src/schema/sponsorLicences.ts) | Not established by graph; inspect raw identifiers/JSON | id, utcDate, organisationName, createdAt | No inline FK declaration |
| company_site_host_states (companySiteHostStatesTable), [source](../../lib/db/src/schema/sponsorLicences.ts) | Not established by graph; inspect raw identifiers/JSON | id, hostname, robotsBody, robotsCheckedAt, lastRequestAt, requestLeaseUntil, requestLeaseToken, failureCount, retryAfter, createdAt, updatedAt | No inline FK declaration |
| sponsor_licence_vacancies (sponsorLicenceVacanciesTable), [source](../../lib/db/src/schema/sponsorLicences.ts) | Not established by graph; inspect raw identifiers/JSON | id, organisationName, checkDate, title, location, salary, url, applicationUrl, sourceType, boardName, externalListingId, description, requiredDbsClearanceLevel, requiredSafeguardingLevel, targetRegions, postedDate, createdAt, lastDiscoveredAt, liveness, lastVerifiedAt, livenessReason, closesAt, expiresAt, closedReason, companyVacancyEvidence, sourceMetadata, companyEvidenceLegacyUntil, sourceMissingSince, sourceMissingObservations | No inline FK declaration |
| sponsor_licence_bookmarks (sponsorLicenceBookmarksTable), [source](../../lib/db/src/schema/sponsorLicences.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, sponsorLicenceId, createdAt | No inline FK declaration |
| sponsor_licence_vacancy_scores (sponsorLicenceVacancyScoresTable), [source](../../lib/db/src/schema/sponsorLicences.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, vacancyId, organisationName, score, isEligible, missingRequirements, explanation, scoredAt | No inline FK declaration |
| sponsor_licence_gap_analyses (sponsorLicenceGapAnalysesTable), [source](../../lib/db/src/schema/sponsorLicences.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, vacancyId, matchedRequirements, gaps, optimizationSteps, generatedAt | No inline FK declaration |
| support_tickets (supportTicketsTable), [source](../../lib/db/src/schema/supportTickets.ts) | Yes — ownership and sharing need review | id, ticketId, name, email, category, subject, message, userId, status, adminNotes, reviewedBy, reviewedAt, createdAt, updatedAt | userId → usersTable; "set null"<br>reviewedBy → usersTable; "set null" |
| support_ticket_replies (supportTicketRepliesTable), [source](../../lib/db/src/schema/supportTickets.ts) | Yes — ownership and sharing need review | id, ticketId, adminUserId, adminDisplayName, replyText, deliveryChannel, deliveryStatus, candidateMessageId, createdAt | ticketId → supportTicketsTable; "cascade"<br>candidateMessageId → candidateMessagesTable; "set null" |
| vacancy_ai_usage (vacancyAiUsageTable), [source](../../lib/db/src/schema/vacancyAiUsage.ts) | Not established by graph; inspect raw identifiers/JSON | id, londonDate, usedCount, updatedAt | No inline FK declaration |
| vacancy_favorites (vacancyFavoritesTable), [source](../../lib/db/src/schema/vacancyFavorites.ts) | Not established by graph; inspect raw identifiers/JSON | id, userId, vacancyId, createdAt | No inline FK declaration |
| vacancy_source_states (vacancySourceStatesTable), [source](../../lib/db/src/schema/vacancySources.ts) | Not established by graph; inspect raw identifiers/JSON | sourceId, provider, sourceType, boardName, parserVersion, cursor, sweepStartedAt, lastRunAt, lastSuccessAt, lastExhaustedAt, lastOutcome, lastError, reportedTotal, consecutiveFailures, nextRetryAt, updatedAt | No inline FK declaration |
| vacancy_source_observations (vacancySourceObservationsTable), [source](../../lib/db/src/schema/vacancySources.ts) | Not established by graph; inspect raw identifiers/JSON | id, vacancyId, sourceId, provider, sourceType, boardName, externalId, url, canonicalUrl, applicationUrl, sourceMetadata, parserVersion, firstSeenAt, lastSeenAt, missingSince | vacancyId → sponsorLicenceVacanciesTable; "cascade" |
| vacancy_source_listing_audits (vacancySourceListingAuditsTable), [source](../../lib/db/src/schema/vacancySources.ts) | Not established by graph; inspect raw identifiers/JSON | id, sourceId, provider, boardName, externalId, employerName, title, listingUrl, matchReason, parserVersion, firstSeenAt, lastSeenAt | No inline FK declaration |

## Mandatory non-FK follow-up

- Authentication/session JSON includes both ordinary user snapshots and short-lived mobile exchange records. Delete/revoke both ownership forms; do not expose either in exports.
- Find every user-owned object path before deleting database references. Preserve an idempotent, retryable erasure ledger until object/provider work finishes.
- Shared messages, employer jobs, received references, audit and financial/marketing records need explicit delete/anonymise/retain decisions; source FK actions are not legal justification.
- Review native SecureStore credentials and opt-in answer library, temporary documents, WebView cookies/cache, Chrome storage and saved server drafts separately.
- Record erasure failures without file contents, credentials or personal data; distinguish accepted, processing, failed/retrying and completed requests.
- Before destructive implementation, complete the data-inventory.md decisions and verify all row selectors against isolated fixtures.
