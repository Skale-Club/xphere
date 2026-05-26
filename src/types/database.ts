// Database type definitions for Opps
// Auto-generated shape | replace with Supabase CLI output after applying migrations:
//   npx supabase gen types typescript --local > src/types/database.ts
//
// These types match the schema defined in supabase/migrations/001_foundation.sql

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type UserRole = 'admin' | 'member'

export type NotificationType = 'new_conversation' | 'missed_call' | 'flow_failed'

export type CampaignStatus = 'draft' | 'scheduled' | 'in_progress' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped'
export type CampaignChannel = 'calls' | 'sms' | 'email' | 'whatsapp'
export type CampaignType = 'one_time' | 'flow'
export type CampaignContactStatus = 'pending' | 'calling' | 'completed' | 'failed' | 'no_answer'
export type CampaignRecipientStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'skipped' | 'unsubscribed'

export type ConversationChannel = 'widget' | 'messenger' | 'instagram'
export type MetaChannelType = 'messenger' | 'instagram'

// v2.0 (Phase 33) | agent runtime enums
export type AgentChannel = 'web_widget' | 'whatsapp' | 'messenger' | 'instagram' | 'manychat' | 'telegram' | 'sms'
export type AgentInvocationStatus = 'success' | 'error' | 'aborted' | 'skipped' | 'denied' | 'running'
export type AgentInvocationMode = 'production' | 'playground'

// v2.1 | contacts (CRM) source enum
export type ContactSource = 'manual' | 'whatsapp' | 'sms' | 'instagram' | 'csv_import' | 'ghl_sync'

// v2.4 � accounts (CRM Companies) source enum (SEED-016)
export type AccountSource = 'manual' | 'auto_from_contact_company' | 'csv_import' | 'ghl_sync'

// v2.4 � custom_field_definitions (Custom Fields System) � SEED-017
export type CustomFieldType =
  | 'text'
  | 'long_text'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multi_select'
  | 'url'
  | 'email'
  | 'phone'
  | 'currency'

export type CustomFieldEntity = 'contact' | 'opportunity' | 'account'

// v2.5 � tasks & notes (v2.5 Tasks & Notes CRM System)
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled'
export type CrmEntityType = 'contact' | 'account' | 'opportunity'

// v2.4 � contact_imports (Import Pipeline) � SEED-018
export type ContactImportStatus =
  | 'uploading'
  | 'parsing'
  | 'previewing'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled'

export type ContactImportDedupStrategy =
  | 'skip_existing'
  | 'update_existing'
  | 'create_duplicate'

// v2.1 | call system (SEED-007)
export type CallRoutingMode = 'phone_forward' | 'sip' | 'browser'
export type CallDirection = 'inbound' | 'outbound'

// v2.1 - sales pipeline (SEED-008)
export type OpportunityStatus = 'open' | 'won' | 'lost'
export type OpportunityActivityType =
  | 'note'
  | 'call'
  | 'whatsapp'
  | 'sms'
  | 'instagram'
  | 'stage_change'
  | 'email'
  | 'created'
  | 'won'
  | 'lost'

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          slug: string
          is_active: boolean
          widget_token: string
          widget_display_name: string | null
          widget_avatar_url: string | null
          widget_primary_color: string | null
          widget_welcome_message: string | null
          daily_cost_cap_usd_override: number | null
          delegation_visibility: string
          logo_url: string | null
          accent_color: string | null
          brand_name: string | null
          default_currency: string
          settings: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          is_active?: boolean
          widget_token?: string
          widget_display_name?: string | null
          widget_avatar_url?: string | null
          widget_primary_color?: string | null
          widget_welcome_message?: string | null
          daily_cost_cap_usd_override?: number | null
          delegation_visibility?: string
          logo_url?: string | null
          accent_color?: string | null
          brand_name?: string | null
          default_currency?: string
          settings?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          is_active?: boolean
          widget_token?: string
          widget_display_name?: string | null
          widget_avatar_url?: string | null
          widget_primary_color?: string | null
          widget_welcome_message?: string | null
          daily_cost_cap_usd_override?: number | null
          delegation_visibility?: string
          logo_url?: string | null
          accent_color?: string | null
          brand_name?: string | null
          default_currency?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
      org_members: {
        Row: {
          id: string
          user_id: string
          organization_id: string
          role: UserRole
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          organization_id: string
          role?: UserRole
          created_at?: string
        }
        Update: {
          role?: UserRole
        }
        Relationships: [
          {
            foreignKeyName: 'org_members_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'org_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      org_invites: {
        Row: {
          id: string
          org_id: string
          email: string
          role: UserRole
          invited_by: string | null
          invited_at: string
          accepted_at: string | null
          expires_at: string | null
        }
        Insert: {
          id?: string
          org_id: string
          email: string
          role?: UserRole
          invited_by?: string | null
          invited_at?: string
          accepted_at?: string | null
          expires_at?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          email?: string
          role?: UserRole
          invited_by?: string | null
          invited_at?: string
          accepted_at?: string | null
          expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'org_invites_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      user_active_org: {
        Row: {
          user_id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          user_id: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_active_org_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      assistant_mappings: {
        Row: {
          id: string
          organization_id: string
          vapi_assistant_id: string
          name: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          vapi_assistant_id: string
          name?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          vapi_assistant_id?: string
          name?: string | null
          is_active?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'assistant_mappings_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      integrations: {
        Row: {
          id: string
          organization_id: string
          provider: 'gohighlevel' | 'twilio' | 'calcom' | 'custom_webhook' | 'openai' | 'anthropic' | 'openrouter' | 'vapi' | 'manychat' | 'google_contacts' | 'google_calendar' | 'telegram'
          name: string
          encrypted_api_key: string
          key_hint: string | null
          location_id: string | null
          config: Json
          is_active: boolean
          manychat_channel_id: string | null
          created_at: string
          updated_at: string
          health_status: 'connected' | 'degraded' | 'disconnected' | 'unknown'
          last_checked_at: string | null
          last_error: string | null
          failure_count: number
        }
        Insert: {
          id?: string
          organization_id: string
          provider: 'gohighlevel' | 'twilio' | 'calcom' | 'custom_webhook' | 'openai' | 'anthropic' | 'openrouter' | 'vapi' | 'manychat' | 'google_contacts' | 'google_calendar' | 'telegram'
          name: string
          encrypted_api_key: string
          key_hint?: string | null
          location_id?: string | null
          config?: Json
          is_active?: boolean
          manychat_channel_id?: string | null
          created_at?: string
          updated_at?: string
          health_status?: 'connected' | 'degraded' | 'disconnected' | 'unknown'
          last_checked_at?: string | null
          last_error?: string | null
          failure_count?: number
        }
        Update: {
          name?: string
          encrypted_api_key?: string
          key_hint?: string | null
          location_id?: string | null
          config?: Json
          is_active?: boolean
          manychat_channel_id?: string | null
          updated_at?: string
          health_status?: 'connected' | 'degraded' | 'disconnected' | 'unknown'
          last_checked_at?: string | null
          last_error?: string | null
          failure_count?: number
        }
        Relationships: [
          {
            foreignKeyName: 'integrations_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      twilio_phone_numbers: {
        Row: {
          id: string
          organization_id: string
          e164: string
          phone_sid: string | null
          friendly_name: string
          capability_sms: boolean
          capability_mms: boolean
          capability_voice: boolean
          default_routing_mode: 'browser' | 'sip' | 'forward' | null
          forward_to_number: string | null
          is_default: boolean
          is_active: boolean
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          e164: string
          phone_sid?: string | null
          friendly_name: string
          capability_sms?: boolean
          capability_mms?: boolean
          capability_voice?: boolean
          default_routing_mode?: 'browser' | 'sip' | 'forward' | null
          forward_to_number?: string | null
          is_default?: boolean
          is_active?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          e164?: string
          phone_sid?: string | null
          friendly_name?: string
          capability_sms?: boolean
          capability_mms?: boolean
          capability_voice?: boolean
          default_routing_mode?: 'browser' | 'sip' | 'forward' | null
          forward_to_number?: string | null
          is_default?: boolean
          is_active?: boolean
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'twilio_phone_numbers_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      tool_configs: {
        Row: {
          id: string
          organization_id: string
          integration_id: string | null
          tool_name: string
          action_type: 'send_email' | 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'knowledge_base' | 'custom_webhook' | 'manychat_set_field' | 'manychat_add_tag' | 'manychat_trigger_flow' | 'manychat_send_message' | 'google_contacts_create' | 'google_contacts_update' | 'google_contacts_find' | 'google_contacts_delete' | 'send_whatsapp_message' | 'send_whatsapp_mention_all' | 'send_telegram_notification' | 'pipeline_move_opportunity' | 'pipeline_update_opportunity' | 'pipeline_mark_won' | 'pipeline_mark_lost' | 'pipeline_add_note' | 'pipeline_assign_user' | 'pipeline_create_opportunity' | 'create_task' | 'create_note'
          config: Json
          fallback_message: string
          is_active: boolean
          folder_id: string | null
          labels: string[]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          integration_id?: string | null
          tool_name: string
          action_type: 'send_email' | 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'knowledge_base' | 'custom_webhook' | 'manychat_set_field' | 'manychat_add_tag' | 'manychat_trigger_flow' | 'manychat_send_message' | 'google_contacts_create' | 'google_contacts_update' | 'google_contacts_find' | 'google_contacts_delete' | 'send_whatsapp_message' | 'send_whatsapp_mention_all' | 'send_telegram_notification' | 'pipeline_move_opportunity' | 'pipeline_update_opportunity' | 'pipeline_mark_won' | 'pipeline_mark_lost' | 'pipeline_add_note' | 'pipeline_assign_user' | 'pipeline_create_opportunity' | 'create_task' | 'create_note'
          config?: Json
          fallback_message: string
          is_active?: boolean
          folder_id?: string | null
          labels?: string[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          integration_id?: string | null
          tool_name?: string
          action_type?: 'send_email' | 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'knowledge_base' | 'custom_webhook' | 'manychat_set_field' | 'manychat_add_tag' | 'manychat_trigger_flow' | 'manychat_send_message' | 'google_contacts_create' | 'google_contacts_update' | 'google_contacts_find' | 'google_contacts_delete' | 'send_whatsapp_message' | 'send_whatsapp_mention_all' | 'send_telegram_notification' | 'pipeline_move_opportunity' | 'pipeline_update_opportunity' | 'pipeline_mark_won' | 'pipeline_mark_lost' | 'pipeline_add_note' | 'pipeline_assign_user' | 'pipeline_create_opportunity' | 'create_task' | 'create_note'
          config?: Json
          fallback_message?: string
          is_active?: boolean
          folder_id?: string | null
          labels?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tool_configs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tool_configs_integration_id_fkey'
            columns: ['integration_id']
            isOneToOne: false
            referencedRelation: 'integrations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tool_configs_folder_id_fkey'
            columns: ['folder_id']
            isOneToOne: false
            referencedRelation: 'tool_folders'
            referencedColumns: ['id']
          }
        ]
      }
      tool_folders: {
        Row: {
          id: string
          org_id: string
          name: string
          parent_id: string | null
          position: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          parent_id?: string | null
          position?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tool_folders_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tool_folders_parent_id_fkey'
            columns: ['parent_id']
            isOneToOne: false
            referencedRelation: 'tool_folders'
            referencedColumns: ['id']
          }
        ]
      }
      action_logs: {
        Row: {
          id: string
          organization_id: string
          tool_config_id: string | null
          vapi_call_id: string
          tool_name: string
          status: 'success' | 'error' | 'timeout'
          execution_ms: number
          request_payload: Json
          response_payload: Json
          error_detail: string | null
          created_at: string
          // v2.0 (Phase 33, migration 037 | OBS-02 additive): NULL = legacy v1.x action
          agent_invocation_id: string | null
          trace_id: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          tool_config_id?: string | null
          vapi_call_id: string
          tool_name: string
          status: 'success' | 'error' | 'timeout'
          execution_ms: number
          request_payload?: Json
          response_payload?: Json
          error_detail?: string | null
          created_at?: string
          agent_invocation_id?: string | null
          trace_id?: string | null
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'action_logs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'action_logs_tool_config_id_fkey'
            columns: ['tool_config_id']
            isOneToOne: false
            referencedRelation: 'tool_configs'
            referencedColumns: ['id']
          }
        ]
      }
      // ----------------------------------------------------------------------
      // v2.0 (Phase 33) | agent runtime tables (migrations 034-038)
      // ----------------------------------------------------------------------
      agents: {
        Row: {
          id: string
          organization_id: string
          name: string
          slug: string
          description: string | null
          system_prompt: string
          model: string
          fallback_message: string
          max_history: number
          kb_scope: string[] | null
          channel_overrides: Json
          allowed_channels: AgentChannel[]
          is_active: boolean
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
          active_prompt_version_id: string | null
          temperature: number | null
          max_tokens: number | null
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          slug: string
          description?: string | null
          system_prompt: string
          model?: string
          fallback_message?: string
          max_history?: number
          kb_scope?: string[] | null
          channel_overrides?: Json
          allowed_channels?: AgentChannel[]
          is_active?: boolean
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
          active_prompt_version_id?: string | null
          temperature?: number | null
          max_tokens?: number | null
        }
        Update: {
          name?: string
          slug?: string
          description?: string | null
          system_prompt?: string
          model?: string
          fallback_message?: string
          max_history?: number
          kb_scope?: string[] | null
          channel_overrides?: Json
          allowed_channels?: AgentChannel[]
          is_active?: boolean
          updated_by?: string | null
          updated_at?: string
          active_prompt_version_id?: string | null
          temperature?: number | null
          max_tokens?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'agents_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agents_active_prompt_version_id_fkey'
            columns: ['active_prompt_version_id']
            isOneToOne: false
            referencedRelation: 'agent_prompt_versions'
            referencedColumns: ['id']
          }
        ]
      }
      agent_tools: {
        Row: {
          id: string
          organization_id: string
          agent_id: string
          tool_config_id: string | null
          workflow_id: string | null
          allowed_channels: AgentChannel[] | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          agent_id: string
          tool_config_id?: string | null
          workflow_id?: string | null
          allowed_channels?: AgentChannel[] | null
          created_at?: string
        }
        Update: {
          tool_config_id?: string | null
          workflow_id?: string | null
          allowed_channels?: AgentChannel[] | null
        }
        Relationships: [
          {
            foreignKeyName: 'agent_tools_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_tools_agent_id_fkey'
            columns: ['agent_id']
            isOneToOne: false
            referencedRelation: 'agents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_tools_tool_config_id_fkey'
            columns: ['tool_config_id']
            isOneToOne: false
            referencedRelation: 'tool_configs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_tools_workflow_id_fkey'
            columns: ['workflow_id']
            isOneToOne: false
            referencedRelation: 'workflows'
            referencedColumns: ['id']
          }
        ]
      }
      agent_partners: {
        Row: {
          id: string
          organization_id: string
          agent_id: string
          partner_agent_id: string
          invocation_description: string
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          agent_id: string
          partner_agent_id: string
          invocation_description: string
          created_at?: string
        }
        Update: {
          invocation_description?: string
        }
        Relationships: [
          {
            foreignKeyName: 'agent_partners_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_partners_agent_id_fkey'
            columns: ['agent_id']
            isOneToOne: false
            referencedRelation: 'agents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_partners_partner_agent_id_fkey'
            columns: ['partner_agent_id']
            isOneToOne: false
            referencedRelation: 'agents'
            referencedColumns: ['id']
          }
        ]
      }
      agent_prompt_versions: {
        Row: {
          id: string
          organization_id: string
          agent_id: string
          version: number
          system_prompt: string
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          agent_id: string
          version: number
          system_prompt: string
          created_by?: string | null
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'agent_prompt_versions_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_prompt_versions_agent_id_fkey'
            columns: ['agent_id']
            isOneToOne: false
            referencedRelation: 'agents'
            referencedColumns: ['id']
          }
        ]
      }
      agent_channel_defaults: {
        Row: {
          id: string
          organization_id: string
          channel: AgentChannel
          agent_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          channel: AgentChannel
          agent_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'agent_channel_defaults_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_channel_defaults_agent_id_fkey'
            columns: ['agent_id']
            isOneToOne: false
            referencedRelation: 'agents'
            referencedColumns: ['id']
          }
        ]
      }
      agent_invocations: {
        Row: {
          id: string
          organization_id: string
          agent_id: string
          parent_invocation_id: string | null
          trace_id: string
          channel: AgentChannel
          conversation_id: string | null
          session_id: string | null
          depth: number
          status: AgentInvocationStatus
          mode: AgentInvocationMode
          user_message: string | null
          assistant_reply: string | null
          tool_calls: Json
          partner_calls: Json
          tokens_in: number | null
          tokens_out: number | null
          cost_usd: number | null
          model: string | null
          duration_ms: number | null
          error_detail: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          agent_id: string
          parent_invocation_id?: string | null
          trace_id: string
          channel: AgentChannel
          conversation_id?: string | null
          session_id?: string | null
          depth?: number
          status: AgentInvocationStatus
          mode?: AgentInvocationMode
          user_message?: string | null
          assistant_reply?: string | null
          tool_calls?: Json
          partner_calls?: Json
          tokens_in?: number | null
          tokens_out?: number | null
          cost_usd?: number | null
          model?: string | null
          duration_ms?: number | null
          error_detail?: string | null
          created_at?: string
        }
        Update: {
          status?: AgentInvocationStatus
          assistant_reply?: string | null
          tool_calls?: Json
          partner_calls?: Json
          tokens_in?: number | null
          tokens_out?: number | null
          cost_usd?: number | null
          model?: string | null
          duration_ms?: number | null
          error_detail?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'agent_invocations_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_invocations_agent_id_fkey'
            columns: ['agent_id']
            isOneToOne: false
            referencedRelation: 'agents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'agent_invocations_parent_invocation_id_fkey'
            columns: ['parent_invocation_id']
            isOneToOne: false
            referencedRelation: 'agent_invocations'
            referencedColumns: ['id']
          }
        ]
      }
      tool_idempotency_keys: {
        Row: {
          id: string
          organization_id: string
          agent_invocation_id: string | null
          idempotency_key: string
          tool_name: string
          request_hash: string
          response: Json
          created_at: string
          expires_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          agent_invocation_id?: string | null
          idempotency_key: string
          tool_name: string
          request_hash: string
          response: Json
          created_at?: string
          expires_at?: string
        }
        Update: {
          response?: Json
          expires_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tool_idempotency_keys_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tool_idempotency_keys_agent_invocation_id_fkey'
            columns: ['agent_invocation_id']
            isOneToOne: false
            referencedRelation: 'agent_invocations'
            referencedColumns: ['id']
          }
        ]
      }
      agent_model_pricing: {
        Row: {
          model: string
          source: string
          input_per_1m_usd: number
          output_per_1m_usd: number
          notes: string | null
          updated_at: string
        }
        Insert: {
          model: string
          source: string
          input_per_1m_usd: number
          output_per_1m_usd: number
          notes?: string | null
          updated_at?: string
        }
        Update: {
          source?: string
          input_per_1m_usd?: number
          output_per_1m_usd?: number
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ghl_channels: {
        Row: {
          id: string
          org_id: string
          location_id: string
          display_name: string | null
          encrypted_api_key: string
          webhook_secret: string
          is_active: boolean
          agent_id: string | null
          automation_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          location_id: string
          display_name?: string | null
          encrypted_api_key: string
          webhook_secret: string
          is_active?: boolean
          agent_id?: string | null
          automation_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          display_name?: string | null
          encrypted_api_key?: string
          webhook_secret?: string
          is_active?: boolean
          agent_id?: string | null
          automation_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'ghl_channels_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      ghl_events: {
        Row: {
          id: string
          org_id: string
          location_id: string
          contact_id: string | null
          conversation_id: string | null
          message_type: string | null
          direction: string | null
          body: string | null
          phone: string | null
          first_name: string | null
          last_name: string | null
          email: string | null
          raw_payload: Json
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          location_id: string
          contact_id?: string | null
          conversation_id?: string | null
          message_type?: string | null
          direction?: string | null
          body?: string | null
          phone?: string | null
          first_name?: string | null
          last_name?: string | null
          email?: string | null
          raw_payload?: Json
          created_at?: string
        }
        Update: {
          body?: string | null
          direction?: string | null
          raw_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'ghl_events_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      ghl_reengagement_sent: {
        Row: {
          id: string
          org_id: string
          location_id: string
          ghl_contact_id: string
          sent_at: string
        }
        Insert: {
          id?: string
          org_id: string
          location_id: string
          ghl_contact_id: string
          sent_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          location_id?: string
          ghl_contact_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'ghl_reengagement_sent_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      automation_schedules: {
        Row: {
          id: string
          automation_key: string
          is_active: boolean
          next_run_at: string
          interval_minutes: number
          last_run_at: string | null
          last_run_status: 'success' | 'error' | 'skipped' | null
          last_run_result: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          automation_key: string
          is_active?: boolean
          next_run_at: string
          interval_minutes: number
          last_run_at?: string | null
          last_run_status?: 'success' | 'error' | 'skipped' | null
          last_run_result?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          automation_key?: string
          is_active?: boolean
          next_run_at?: string
          interval_minutes?: number
          last_run_at?: string | null
          last_run_status?: 'success' | 'error' | 'skipped' | null
          last_run_result?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      calls: {
        Row: {
          id: string
          organization_id: string
          vapi_call_id: string
          assistant_id: string | null
          call_type: string | null
          status: string | null
          ended_reason: string | null
          started_at: string | null
          ended_at: string | null
          duration_seconds: number | null
          cost: number | null
          customer_number: string | null
          customer_name: string | null
          summary: string | null
          transcript: string | null
          transcript_turns: Json
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          vapi_call_id: string
          assistant_id?: string | null
          call_type?: string | null
          status?: string | null
          ended_reason?: string | null
          started_at?: string | null
          ended_at?: string | null
          cost?: number | null
          customer_number?: string | null
          customer_name?: string | null
          summary?: string | null
          transcript?: string | null
          transcript_turns?: Json
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'calls_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      knowledge_sources: {
        Row: {
          id: string
          organization_id: string
          name: string
          source_type: 'pdf' | 'text' | 'csv' | 'url'
          source_url: string | null
          status: 'processing' | 'ready' | 'error'
          error_detail: string | null
          chunk_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          source_type: 'pdf' | 'text' | 'csv' | 'url'
          source_url?: string | null
          status?: 'processing' | 'ready' | 'error'
          error_detail?: string | null
          chunk_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          status?: 'processing' | 'ready' | 'error'
          error_detail?: string | null
          chunk_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'knowledge_sources_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      documents: {
        Row: {
          id: number
          content: string
          metadata: Json
          embedding: number[] | null
          knowledge_source_id: string | null
          created_at: string
        }
        Insert: {
          id?: number
          content: string
          metadata?: Json
          embedding?: number[] | null
          knowledge_source_id?: string | null
          created_at?: string
        }
        Update: {
          embedding?: number[] | null
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'documents_knowledge_source_id_fkey'
            columns: ['knowledge_source_id']
            isOneToOne: false
            referencedRelation: 'knowledge_sources'
            referencedColumns: ['id']
          }
        ]
      }
      evolution_instances: {
        Row: {
          id: string
          org_id: string
          instance_name: string
          base_url: string
          token_encrypted: string
          webhook_secret_encrypted: string | null
          status: 'disconnected' | 'connecting' | 'connected' | 'qr_pending'
          phone_number: string | null
          connected_at: string | null
          last_error: string | null
          is_active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          instance_name: string
          base_url: string
          token_encrypted: string
          webhook_secret_encrypted?: string | null
          status?: 'disconnected' | 'connecting' | 'connected' | 'qr_pending'
          phone_number?: string | null
          connected_at?: string | null
          last_error?: string | null
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          instance_name?: string
          base_url?: string
          token_encrypted?: string
          webhook_secret_encrypted?: string | null
          status?: 'disconnected' | 'connecting' | 'connected' | 'qr_pending'
          phone_number?: string | null
          connected_at?: string | null
          last_error?: string | null
          is_active?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'evolution_instances_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      conversations: {
        Row: {
          id: string
          org_id: string
          widget_token: string
          session_key: string | null
          status: string
          last_active_at: string
          created_at: string
          updated_at: string
          last_message_at: string | null
          first_page_url: string | null
          visitor_name: string | null
          visitor_phone: string | null
          visitor_email: string | null
          last_message: string | null
          memory: Record<string, unknown>
          channel: string
          channel_metadata: Json
          last_inbound_at: string | null
          bot_status: string
          assigned_user_id: string | null
          agent_id: string | null
          contact_id: string | null
          evolution_instance_id: string | null
          pinned: boolean
          priority: string
          starred: boolean
          wait_until: string | null
        }
        Insert: {
          id?: string
          org_id: string
          widget_token: string
          session_key?: string | null
          status?: string
          last_active_at?: string
          created_at?: string
          updated_at?: string
          last_message_at?: string | null
          first_page_url?: string | null
          visitor_name?: string | null
          visitor_phone?: string | null
          visitor_email?: string | null
          last_message?: string | null
          memory?: Record<string, unknown>
          channel?: string
          channel_metadata?: Json
          last_inbound_at?: string | null
          bot_status?: string
          assigned_user_id?: string | null
          agent_id?: string | null
          contact_id?: string | null
          evolution_instance_id?: string | null
          pinned?: boolean
          priority?: string
          starred?: boolean
          wait_until?: string | null
        }
        Update: {
          status?: string
          last_active_at?: string
          updated_at?: string
          last_message_at?: string | null
          visitor_name?: string | null
          visitor_phone?: string | null
          visitor_email?: string | null
          last_message?: string | null
          memory?: Record<string, unknown>
          channel?: string
          channel_metadata?: Json
          last_inbound_at?: string | null
          bot_status?: string
          assigned_user_id?: string | null
          agent_id?: string | null
          contact_id?: string | null
          evolution_instance_id?: string | null
          pinned?: boolean
          priority?: string
          starred?: boolean
          wait_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'conversations_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      conversation_messages: {
        Row: {
          id: string
          conversation_id: string
          org_id: string
          role: string
          content: string
          created_at: string
          metadata: Record<string, unknown> | null
          message_type: string
          channel: string | null
        }
        Insert: {
          id?: string
          conversation_id: string
          org_id: string
          role: string
          content: string
          created_at?: string
          metadata?: Record<string, unknown> | null
          message_type?: string
          channel?: string | null
        }
        Update: {
          role?: string
          content?: string
          metadata?: Record<string, unknown> | null
          message_type?: string
          channel?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'conversation_messages_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'conversations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'conversation_messages_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      contacts: {
        Row: {
          id: string
          org_id: string
          first_name: string | null
          last_name: string | null
          name: string | null
          phone: string | null
          email: string | null
          company: string | null
          notes: string | null
          tags: string[]
          custom_fields: Record<string, unknown>
          source: ContactSource
          external_id: string | null
          account_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          first_name?: string | null
          last_name?: string | null
          name?: string | null
          phone?: string | null
          email?: string | null
          company?: string | null
          notes?: string | null
          tags?: string[]
          custom_fields?: Record<string, unknown>
          source?: ContactSource
          external_id?: string | null
          account_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          first_name?: string | null
          last_name?: string | null
          name?: string | null
          phone?: string | null
          email?: string | null
          company?: string | null
          notes?: string | null
          tags?: string[]
          custom_fields?: Record<string, unknown>
          source?: ContactSource
          external_id?: string | null
          account_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'contacts_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'contacts_account_id_fkey'
            columns: ['account_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          }
        ]
      }
      accounts: {
        Row: {
          id: string
          org_id: string
          name: string
          domain: string | null
          website: string | null
          industry: string | null
          size: string | null
          phone: string | null
          address: string | null
          notes: string | null
          tags: string[]
          custom_fields: Record<string, unknown>
          external_id: string | null
          source: AccountSource
          assigned_to: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          domain?: string | null
          website?: string | null
          industry?: string | null
          size?: string | null
          phone?: string | null
          address?: string | null
          notes?: string | null
          tags?: string[]
          custom_fields?: Record<string, unknown>
          external_id?: string | null
          source?: AccountSource
          assigned_to?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          domain?: string | null
          website?: string | null
          industry?: string | null
          size?: string | null
          phone?: string | null
          address?: string | null
          notes?: string | null
          tags?: string[]
          custom_fields?: Record<string, unknown>
          external_id?: string | null
          source?: AccountSource
          assigned_to?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'accounts_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      custom_field_definitions: {
        Row: {
          id: string
          org_id: string
          entity: CustomFieldEntity
          key: string
          label: string
          type: CustomFieldType
          required: boolean
          unique_per_org: boolean
          position: number
          group_name: string | null
          help_text: string | null
          default_value: unknown | null
          options: unknown | null
          validation: unknown | null
          visible_in_list: boolean
          filterable: boolean
          archived: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          entity: CustomFieldEntity
          key: string
          label: string
          type: CustomFieldType
          required?: boolean
          unique_per_org?: boolean
          position?: number
          group_name?: string | null
          help_text?: string | null
          default_value?: unknown | null
          options?: unknown | null
          validation?: unknown | null
          visible_in_list?: boolean
          filterable?: boolean
          archived?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          key?: string
          label?: string
          type?: CustomFieldType
          required?: boolean
          unique_per_org?: boolean
          position?: number
          group_name?: string | null
          help_text?: string | null
          default_value?: unknown | null
          options?: unknown | null
          validation?: unknown | null
          visible_in_list?: boolean
          filterable?: boolean
          archived?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'custom_field_definitions_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'custom_field_definitions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      contact_imports: {
        Row: {
          id: string
          org_id: string
          storage_path: string
          filename: string
          size_bytes: number
          mime_type: string | null
          status: ContactImportStatus
          status_message: string | null
          error_summary: string | null
          mapping: Record<string, string | null>
          dedup_strategy: ContactImportDedupStrategy
          dedup_keys: string[] | null
          default_tags: string[] | null
          default_source: string | null
          default_assigned_to: string | null
          total_rows: number
          processed_rows: number
          inserted_rows: number
          updated_rows: number
          skipped_rows: number
          error_rows: number
          progress_percent: number
          started_at: string | null
          finished_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          storage_path: string
          filename: string
          size_bytes: number
          mime_type?: string | null
          status?: ContactImportStatus
          status_message?: string | null
          error_summary?: string | null
          mapping?: Record<string, string | null>
          dedup_strategy?: ContactImportDedupStrategy
          dedup_keys?: string[] | null
          default_tags?: string[] | null
          default_source?: string | null
          default_assigned_to?: string | null
          total_rows?: number
          processed_rows?: number
          inserted_rows?: number
          updated_rows?: number
          skipped_rows?: number
          error_rows?: number
          // progress_percent OMITTED � GENERATED ALWAYS, never writable
          started_at?: string | null
          finished_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          storage_path?: string
          filename?: string
          size_bytes?: number
          mime_type?: string | null
          status?: ContactImportStatus
          status_message?: string | null
          error_summary?: string | null
          mapping?: Record<string, string | null>
          dedup_strategy?: ContactImportDedupStrategy
          dedup_keys?: string[] | null
          default_tags?: string[] | null
          default_source?: string | null
          default_assigned_to?: string | null
          total_rows?: number
          processed_rows?: number
          inserted_rows?: number
          updated_rows?: number
          skipped_rows?: number
          error_rows?: number
          // progress_percent OMITTED � GENERATED ALWAYS, never writable
          started_at?: string | null
          finished_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'contact_imports_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'contact_imports_default_assigned_to_fkey'
            columns: ['default_assigned_to']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'contact_imports_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      contact_import_errors: {
        Row: {
          id: string
          import_id: string
          row_number: number
          raw_row: Record<string, unknown>
          field: string | null
          message: string
          created_at: string
        }
        Insert: {
          id?: string
          import_id: string
          row_number: number
          raw_row: Record<string, unknown>
          field?: string | null
          message: string
          created_at?: string
        }
        Update: {
          // errors are append-only; only message is realistically updatable
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: 'contact_import_errors_import_id_fkey'
            columns: ['import_id']
            isOneToOne: false
            referencedRelation: 'contact_imports'
            referencedColumns: ['id']
          }
        ]
      }
      unified_calls: {
        Row: {
          id: string
          call_type: 'ai' | 'human'
          org_id: string
          external_id: string
          counterpart_number: string | null
          counterpart_name: string | null
          contact_id: string | null
          direction: 'inbound' | 'outbound'
          duration_seconds: number | null
          status: string | null
          substatus: string | null
          recording_url: string | null
          recording_duration: number | null
          transcript: string | null
          notes: string | null
          cost: number | null
          assistant_id: string | null
          routing_mode: string | null
          started_at: string | null
          ended_at: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      tags: {
        Row: {
          id: string
          org_id: string
          name: string
          slug: string
          color: string
          created_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          slug: string
          color?: string
          created_at?: string
          created_by?: string | null
        }
        Update: {
          name?: string
          slug?: string
          color?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tags_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      contact_tags: {
        Row: {
          contact_id: string
          tag_id: string
          tagged_at: string
          tagged_by: string | null
        }
        Insert: {
          contact_id: string
          tag_id: string
          tagged_at?: string
          tagged_by?: string | null
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'contact_tags_contact_id_fkey'
            columns: ['contact_id']
            isOneToOne: false
            referencedRelation: 'contacts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'contact_tags_tag_id_fkey'
            columns: ['tag_id']
            isOneToOne: false
            referencedRelation: 'tags'
            referencedColumns: ['id']
          }
        ]
      }
      opportunity_tags: {
        Row: {
          opportunity_id: string
          tag_id: string
          tagged_at: string
          tagged_by: string | null
        }
        Insert: {
          opportunity_id: string
          tag_id: string
          tagged_at?: string
          tagged_by?: string | null
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'opportunity_tags_opportunity_id_fkey'
            columns: ['opportunity_id']
            isOneToOne: false
            referencedRelation: 'opportunities'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'opportunity_tags_tag_id_fkey'
            columns: ['tag_id']
            isOneToOne: false
            referencedRelation: 'tags'
            referencedColumns: ['id']
          }
        ]
      }
      call_settings: {
        Row: {
          id: string
          org_id: string
          user_id: string
          routing_mode: CallRoutingMode
          phone_forward: string | null
          sip_username: string | null
          sip_password_encrypted: string | null
          twilio_client_identity: string | null
          record_calls: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id: string
          routing_mode?: CallRoutingMode
          phone_forward?: string | null
          sip_username?: string | null
          sip_password_encrypted?: string | null
          twilio_client_identity?: string | null
          record_calls?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          routing_mode?: CallRoutingMode
          phone_forward?: string | null
          sip_username?: string | null
          sip_password_encrypted?: string | null
          twilio_client_identity?: string | null
          record_calls?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'call_settings_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      call_logs: {
        Row: {
          id: string
          org_id: string
          contact_id: string | null
          opportunity_id: string | null
          call_sid: string
          direction: CallDirection
          routing_mode: CallRoutingMode | null
          from_number: string | null
          to_number: string | null
          status: string | null
          duration_seconds: number | null
          recording_url: string | null
          recording_duration: number | null
          started_at: string | null
          ended_at: string | null
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          contact_id?: string | null
          opportunity_id?: string | null
          call_sid: string
          direction: CallDirection
          routing_mode?: CallRoutingMode | null
          from_number?: string | null
          to_number?: string | null
          status?: string | null
          duration_seconds?: number | null
          recording_url?: string | null
          recording_duration?: number | null
          started_at?: string | null
          ended_at?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          contact_id?: string | null
          opportunity_id?: string | null
          routing_mode?: CallRoutingMode | null
          from_number?: string | null
          to_number?: string | null
          status?: string | null
          duration_seconds?: number | null
          recording_url?: string | null
          recording_duration?: number | null
          started_at?: string | null
          ended_at?: string | null
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'call_logs_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'call_logs_contact_id_fkey'
            columns: ['contact_id']
            isOneToOne: false
            referencedRelation: 'contacts'
            referencedColumns: ['id']
          }
        ]
      }
      pipelines: {
        Row: {
          id: string
          org_id: string
          name: string
          is_default: boolean
          position: number
          card_fields: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          is_default?: boolean
          position?: number
          card_fields?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          is_default?: boolean
          position?: number
          card_fields?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'pipelines_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      pipeline_stages: {
        Row: {
          id: string
          pipeline_id: string
          org_id: string
          name: string
          position: number
          color: string
          is_won: boolean
          is_lost: boolean
          created_at: string
        }
        Insert: {
          id?: string
          pipeline_id: string
          org_id: string
          name: string
          position: number
          color?: string
          is_won?: boolean
          is_lost?: boolean
          created_at?: string
        }
        Update: {
          name?: string
          position?: number
          color?: string
          is_won?: boolean
          is_lost?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'pipeline_stages_pipeline_id_fkey'
            columns: ['pipeline_id']
            isOneToOne: false
            referencedRelation: 'pipelines'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'pipeline_stages_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      push_subscriptions: {
        Row: {
          id: string
          user_id: string
          org_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          org_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent?: string | null
          created_at?: string
        }
        Update: {
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'push_subscriptions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'push_subscriptions_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      opportunities: {
        Row: {
          id: string
          org_id: string
          contact_id: string | null
          account_id: string | null
          pipeline_id: string
          stage_id: string
          title: string
          value: number
          currency: string
          status: OpportunityStatus
          expected_close_date: string | null
          assigned_to: string | null
          position: number
          custom_fields: Record<string, unknown>
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          contact_id?: string | null
          account_id?: string | null
          pipeline_id: string
          stage_id: string
          title: string
          value?: number
          currency?: string
          status?: OpportunityStatus
          expected_close_date?: string | null
          assigned_to?: string | null
          position?: number
          custom_fields?: Record<string, unknown>
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          contact_id?: string | null
          account_id?: string | null
          pipeline_id?: string
          stage_id?: string
          title?: string
          value?: number
          currency?: string
          status?: OpportunityStatus
          expected_close_date?: string | null
          assigned_to?: string | null
          position?: number
          custom_fields?: Record<string, unknown>
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'opportunities_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'opportunities_contact_id_fkey'
            columns: ['contact_id']
            isOneToOne: false
            referencedRelation: 'contacts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'opportunities_account_id_fkey'
            columns: ['account_id']
            isOneToOne: false
            referencedRelation: 'accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'opportunities_pipeline_id_fkey'
            columns: ['pipeline_id']
            isOneToOne: false
            referencedRelation: 'pipelines'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'opportunities_stage_id_fkey'
            columns: ['stage_id']
            isOneToOne: false
            referencedRelation: 'pipeline_stages'
            referencedColumns: ['id']
          }
        ]
      }
      opportunity_contacts: {
        Row: {
          id: string
          org_id: string
          opportunity_id: string
          contact_id: string
          is_primary: boolean
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          opportunity_id: string
          contact_id: string
          is_primary?: boolean
          created_at?: string
        }
        Update: {
          org_id?: string
          opportunity_id?: string
          contact_id?: string
          is_primary?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'opportunity_contacts_opportunity_id_fkey'
            columns: ['opportunity_id']
            isOneToOne: false
            referencedRelation: 'opportunities'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'opportunity_contacts_contact_id_fkey'
            columns: ['contact_id']
            isOneToOne: false
            referencedRelation: 'contacts'
            referencedColumns: ['id']
          }
        ]
      }
      opportunity_activities: {
        Row: {
          id: string
          org_id: string
          opportunity_id: string
          type: OpportunityActivityType
          content: string | null
          call_log_id: string | null
          conversation_id: string | null
          metadata: Record<string, unknown> | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          opportunity_id: string
          type: OpportunityActivityType
          content?: string | null
          call_log_id?: string | null
          conversation_id?: string | null
          metadata?: Record<string, unknown> | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          type?: OpportunityActivityType
          content?: string | null
          metadata?: Record<string, unknown> | null
        }
        Relationships: [
          {
            foreignKeyName: 'opportunity_activities_opportunity_id_fkey'
            columns: ['opportunity_id']
            isOneToOne: false
            referencedRelation: 'opportunities'
            referencedColumns: ['id']
          }
        ]
      }
      campaigns: {
        Row: {
          id: string
          organization_id: string
          name: string
          description: string | null
          channel: CampaignChannel
          campaign_type: CampaignType
          vapi_assistant_id: string | null
          vapi_phone_number_id: string | null
          vapi_campaign_id: string | null
          status: CampaignStatus
          scheduled_start_at: string | null
          started_at: string | null
          completed_at: string | null
          calls_per_minute: number
          audience_filter: Json
          template_config: Json
          metrics: Json
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          description?: string | null
          channel?: CampaignChannel
          campaign_type?: CampaignType
          vapi_assistant_id?: string | null
          vapi_phone_number_id?: string | null
          vapi_campaign_id?: string | null
          status?: CampaignStatus
          scheduled_start_at?: string | null
          started_at?: string | null
          completed_at?: string | null
          calls_per_minute?: number
          audience_filter?: Json
          template_config?: Json
          metrics?: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          description?: string | null
          channel?: CampaignChannel
          campaign_type?: CampaignType
          vapi_campaign_id?: string | null
          status?: CampaignStatus
          scheduled_start_at?: string | null
          started_at?: string | null
          completed_at?: string | null
          calls_per_minute?: number
          audience_filter?: Json
          template_config?: Json
          metrics?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'campaigns_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      campaign_recipients: {
        Row: {
          id: string
          campaign_id: string
          contact_id: string | null
          status: CampaignRecipientStatus
          sent_at: string | null
          result: Json
          error_message: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          campaign_id: string
          contact_id?: string | null
          status?: CampaignRecipientStatus
          sent_at?: string | null
          result?: Json
          error_message?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          status?: CampaignRecipientStatus
          sent_at?: string | null
          result?: Json
          error_message?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'campaign_recipients_campaign_id_fkey'
            columns: ['campaign_id']
            isOneToOne: false
            referencedRelation: 'campaigns'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'campaign_recipients_contact_id_fkey'
            columns: ['contact_id']
            isOneToOne: false
            referencedRelation: 'contacts'
            referencedColumns: ['id']
          }
        ]
      }
      campaign_contacts: {
        Row: {
          id: string
          campaign_id: string
          organization_id: string
          name: string | null
          phone: string
          custom_data: Json
          status: CampaignContactStatus
          vapi_call_id: string | null
          error_detail: string | null
          called_at: string | null
          completed_at: string | null
          retry_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          campaign_id: string
          organization_id: string
          name?: string | null
          phone: string
          custom_data?: Json
          status?: CampaignContactStatus
          vapi_call_id?: string | null
          error_detail?: string | null
          called_at?: string | null
          completed_at?: string | null
          retry_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          status?: CampaignContactStatus
          vapi_call_id?: string | null
          error_detail?: string | null
          called_at?: string | null
          completed_at?: string | null
          retry_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'campaign_contacts_campaign_id_fkey'
            columns: ['campaign_id']
            isOneToOne: false
            referencedRelation: 'campaigns'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'campaign_contacts_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      bookings: {
        Row: {
          id: string
          org_id: string
          event_type_id: string
          booker_name: string
          booker_email: string
          booker_phone: string | null
          booker_timezone: string
          start_at: string
          end_at: string
          notes: string | null
          status: 'confirmed' | 'cancelled' | 'no_show'
          linked_contact_id: string | null
          cancel_token: string
          created_at: string
          updated_at: string
          location_kind: string | null
          location_data: Json
          meeting_url: string | null
          meeting_phone: string | null
        }
        Insert: {
          id?: string
          org_id: string
          event_type_id: string
          booker_name: string
          booker_email: string
          booker_phone?: string | null
          booker_timezone?: string
          start_at: string
          end_at: string
          notes?: string | null
          status?: 'confirmed' | 'cancelled' | 'no_show'
          linked_contact_id?: string | null
          cancel_token?: string
          created_at?: string
          updated_at?: string
          location_kind?: string | null
          location_data?: Json
          meeting_url?: string | null
          meeting_phone?: string | null
        }
        Update: {
          booker_name?: string
          booker_email?: string
          booker_phone?: string | null
          booker_timezone?: string
          start_at?: string
          end_at?: string
          notes?: string | null
          status?: 'confirmed' | 'cancelled' | 'no_show'
          linked_contact_id?: string | null
          updated_at?: string
          location_kind?: string | null
          location_data?: Json
          meeting_url?: string | null
          meeting_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'bookings_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'bookings_event_type_id_fkey'
            columns: ['event_type_id']
            isOneToOne: false
            referencedRelation: 'event_types'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'bookings_linked_contact_id_fkey'
            columns: ['linked_contact_id']
            isOneToOne: false
            referencedRelation: 'contacts'
            referencedColumns: ['id']
          }
        ]
      }
      email_sections: {
        Row: {
          id: string
          org_id: string
          name: string
          type: string
          html_content: string
          is_global: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          type?: string
          html_content?: string
          is_global?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          type?: string
          html_content?: string
          is_global?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'email_sections_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      email_template_sections: {
        Row: {
          id: string
          template_id: string
          section_id: string | null
          type: string
          name: string
          html_content: string
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          template_id: string
          section_id?: string | null
          type?: string
          name: string
          html_content?: string
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          template_id?: string
          section_id?: string | null
          type?: string
          name?: string
          html_content?: string
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'email_template_sections_template_id_fkey'
            columns: ['template_id']
            isOneToOne: false
            referencedRelation: 'email_templates'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'email_template_sections_section_id_fkey'
            columns: ['section_id']
            isOneToOne: false
            referencedRelation: 'email_sections'
            referencedColumns: ['id']
          }
        ]
      }
      email_templates: {
        Row: {
          id: string
          org_id: string
          name: string
          subject_line: string
          preview_text: string
          ai_prompt: string | null
          status: string
          tags: string[]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          subject_line?: string
          preview_text?: string
          ai_prompt?: string | null
          status?: string
          tags?: string[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          subject_line?: string
          preview_text?: string
          ai_prompt?: string | null
          status?: string
          tags?: string[]
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'email_templates_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      event_dispatches: {
        Row: {
          id: string
          org_id: string
          event_type: string
          source_table: string
          source_id: string
          workflow_ids: string[]
          payload: Json
          parent_id: string | null
          depth: number
          dispatched_at: string
        }
        Insert: {
          id?: string
          org_id: string
          event_type: string
          source_table: string
          source_id: string
          workflow_ids?: string[]
          payload?: Json
          parent_id?: string | null
          depth?: number
          dispatched_at?: string
        }
        Update: {
          workflow_ids?: string[]
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'event_dispatches_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      scheduled_workflow_ticks: {
        Row: {
          workflow_id: string
          booking_id: string
          event_type: string
          fired_minute: string
          dispatched_at: string
        }
        Insert: {
          workflow_id: string
          booking_id: string
          event_type: string
          fired_minute: string
          dispatched_at?: string
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'scheduled_workflow_ticks_workflow_id_fkey'
            columns: ['workflow_id']
            isOneToOne: false
            referencedRelation: 'workflows'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'scheduled_workflow_ticks_booking_id_fkey'
            columns: ['booking_id']
            isOneToOne: false
            referencedRelation: 'bookings'
            referencedColumns: ['id']
          }
        ]
      }
      event_types: {
        Row: {
          id: string
          org_id: string
          user_id: string
          title: string
          slug: string
          description: string | null
          duration_minutes: number
          color: string
          location_type: 'video' | 'phone' | 'in_person'
          location_value: string | null
          active: boolean
          allowed_location_kinds: string[]
          default_store_location_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id: string
          title: string
          slug: string
          description?: string | null
          duration_minutes?: number
          color?: string
          location_type?: 'video' | 'phone' | 'in_person'
          location_value?: string | null
          active?: boolean
          allowed_location_kinds?: string[]
          default_store_location_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          title?: string
          slug?: string
          description?: string | null
          duration_minutes?: number
          color?: string
          location_type?: 'video' | 'phone' | 'in_person'
          location_value?: string | null
          active?: boolean
          allowed_location_kinds?: string[]
          default_store_location_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'event_types_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'event_types_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      scheduling_profiles: {
        Row: {
          user_id: string
          org_id: string
          slug: string
          timezone: string
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          org_id: string
          slug: string
          timezone?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'scheduling_profiles_user_id_fkey'
            columns: ['user_id']
            isOneToOne: true
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'scheduling_profiles_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      user_availability: {
        Row: {
          id: string
          org_id: string
          user_id: string
          day_of_week: number
          start_time: string
          end_time: string
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id: string
          day_of_week: number
          start_time: string
          end_time: string
          created_at?: string
        }
        Update: {
          day_of_week?: number
          start_time?: string
          end_time?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_availability_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_availability_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      seo_config: {
        Row: {
          id: string
          site_title: string
          title_template: string
          description: string
          og_image_url: string | null
          keywords: string[]
          updated_at: string
        }
        Insert: {
          id?: string
          site_title?: string
          title_template?: string
          description?: string
          og_image_url?: string | null
          keywords?: string[]
          updated_at?: string
        }
        Update: {
          site_title?: string
          title_template?: string
          description?: string
          og_image_url?: string | null
          keywords?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      landing_config: {
        Row: {
          id: string
          cta_image_url: string | null
          scroll_images: string[]
          updated_at: string
        }
        Insert: {
          id?: string
          cta_image_url?: string | null
          scroll_images?: string[]
          updated_at?: string
        }
        Update: {
          cta_image_url?: string | null
          scroll_images?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          key: string
          encrypted_value: string
          hint: string | null
          updated_at: string
        }
        Insert: {
          key: string
          encrypted_value: string
          hint?: string | null
          updated_at?: string
        }
        Update: {
          key?: string
          encrypted_value?: string
          hint?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      google_business_profiles: {
        Row: {
          id: string
          org_id: string
          place_id: string
          business_name: string | null
          address: string | null
          serpapi_key_encrypted: string
          scrape_interval_hours: number
          last_scraped_at: string | null
          last_scrape_status: string | null
          last_scrape_error: string | null
          total_reviews_count: number | null
          average_rating: number | null
          is_active: boolean
          widget_token: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          place_id: string
          business_name?: string | null
          address?: string | null
          serpapi_key_encrypted: string
          scrape_interval_hours?: number
          last_scraped_at?: string | null
          last_scrape_status?: string | null
          last_scrape_error?: string | null
          total_reviews_count?: number | null
          average_rating?: number | null
          is_active?: boolean
          widget_token?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          place_id?: string
          business_name?: string | null
          address?: string | null
          serpapi_key_encrypted?: string
          scrape_interval_hours?: number
          last_scraped_at?: string | null
          last_scrape_status?: string | null
          last_scrape_error?: string | null
          total_reviews_count?: number | null
          average_rating?: number | null
          is_active?: boolean
          widget_token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'google_business_profiles_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      google_reviews: {
        Row: {
          id: string
          org_id: string
          profile_id: string
          review_id: string
          reviewer_name: string | null
          reviewer_photo_url: string | null
          reviewer_profile_url: string | null
          rating: number
          text: string | null
          date_text: string | null
          date_iso: string | null
          is_local_guide: boolean
          local_guide_reviews_count: number | null
          helpful_count: number
          owner_response: string | null
          owner_response_date: string | null
          is_removed: boolean
          first_seen_at: string
          last_seen_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          profile_id: string
          review_id: string
          reviewer_name?: string | null
          reviewer_photo_url?: string | null
          reviewer_profile_url?: string | null
          rating: number
          text?: string | null
          date_text?: string | null
          date_iso?: string | null
          is_local_guide?: boolean
          local_guide_reviews_count?: number | null
          helpful_count?: number
          owner_response?: string | null
          owner_response_date?: string | null
          is_removed?: boolean
          first_seen_at?: string
          last_seen_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          reviewer_name?: string | null
          reviewer_photo_url?: string | null
          reviewer_profile_url?: string | null
          rating?: number
          text?: string | null
          date_text?: string | null
          date_iso?: string | null
          is_local_guide?: boolean
          local_guide_reviews_count?: number | null
          helpful_count?: number
          owner_response?: string | null
          owner_response_date?: string | null
          is_removed?: boolean
          last_seen_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'google_reviews_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'google_business_profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'google_reviews_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      google_review_photos: {
        Row: {
          id: string
          org_id: string
          review_id: string
          position: number
          original_url: string
          hetzner_url: string | null
          width: number | null
          height: number | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          review_id: string
          position?: number
          original_url: string
          hetzner_url?: string | null
          width?: number | null
          height?: number | null
          created_at?: string
        }
        Update: {
          position?: number
          original_url?: string
          hetzner_url?: string | null
          width?: number | null
          height?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'google_review_photos_review_id_fkey'
            columns: ['review_id']
            isOneToOne: false
            referencedRelation: 'google_reviews'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'google_review_photos_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      meta_channels: {
        Row: {
          id: string
          org_id: string
          channel_type: MetaChannelType
          page_id: string
          page_name: string | null
          ig_account_id: string | null
          ig_username: string | null
          encrypted_page_access_token: string
          token_expires_at: string | null
          is_active: boolean
          webhook_verified: boolean
          last_synced_at: string | null
          connection_error: string | null
          automation_id: string | null
          config: Json
          created_at: string
          updated_at: string
          // v2.0 (Phase 33, migration 039 | CHAN-06): NULL = legacy tool_config_id dispatch
          agent_id: string | null
          // migration 094: provider abstraction ('direct' | 'manychat')
          provider: string
        }
        Insert: {
          id?: string
          org_id: string
          channel_type: MetaChannelType
          page_id: string
          page_name?: string | null
          ig_account_id?: string | null
          ig_username?: string | null
          encrypted_page_access_token: string
          token_expires_at?: string | null
          is_active?: boolean
          webhook_verified?: boolean
          last_synced_at?: string | null
          connection_error?: string | null
          automation_id?: string | null
          config?: Json
          created_at?: string
          updated_at?: string
          agent_id?: string | null
          provider?: string
        }
        Update: {
          channel_type?: MetaChannelType
          page_name?: string | null
          ig_account_id?: string | null
          ig_username?: string | null
          encrypted_page_access_token?: string
          token_expires_at?: string | null
          is_active?: boolean
          webhook_verified?: boolean
          last_synced_at?: string | null
          connection_error?: string | null
          automation_id?: string | null
          config?: Json
          updated_at?: string
          agent_id?: string | null
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: 'meta_channels_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'meta_channels_automation_id_fkey'
            columns: ['automation_id']
            isOneToOne: false
            referencedRelation: 'tool_configs'
            referencedColumns: ['id']
          }
        ]
      }
      manychat_channels: {
        Row: {
          id: string
          org_id: string
          channel_name: string
          encrypted_api_key: string
          key_hint: string | null
          webhook_secret: string
          is_active: boolean
          config: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id?: string       // set by RLS via get_current_org_id() | do not pass manually
          channel_name: string
          encrypted_api_key: string
          key_hint?: string | null
          webhook_secret: string
          is_active?: boolean
          config?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          channel_name?: string
          encrypted_api_key?: string
          key_hint?: string | null
          webhook_secret?: string
          is_active?: boolean
          config?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'manychat_channels_org_id_fkey'
            columns: ['org_id']
            isOneToOne: true
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      manychat_rules: {
        Row: {
          id: string
          org_id: string
          channel_id: string
          event_type: string
          condition: Json
          tool_config_id: string
          is_active: boolean
          priority: number
          created_at: string
          updated_at: string
          // v2.0 (Phase 33, migration 039 | CHAN-06): NULL = legacy tool_config_id dispatch
          agent_id: string | null
        }
        Insert: {
          id?: string
          org_id?: string       // set by RLS via get_current_org_id() | do not pass manually
          channel_id: string
          event_type: string
          condition?: Json
          tool_config_id: string
          is_active?: boolean
          priority?: number
          created_at?: string
          updated_at?: string
          agent_id?: string | null
        }
        Update: {
          channel_id?: string
          event_type?: string
          condition?: Json
          tool_config_id?: string
          is_active?: boolean
          priority?: number
          updated_at?: string
          agent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'manychat_rules_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'manychat_rules_channel_id_fkey'
            columns: ['channel_id']
            isOneToOne: false
            referencedRelation: 'manychat_channels'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'manychat_rules_tool_config_id_fkey'
            columns: ['tool_config_id']
            isOneToOne: false
            referencedRelation: 'tool_configs'
            referencedColumns: ['id']
          }
        ]
      }
      manychat_events: {
        Row: {
          id: string
          org_id: string
          channel_id: string
          event_type: string
          event_payload: Json
          matched_rule_id: string | null
          status: 'matched' | 'unmatched' | 'error'
          action_log_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          channel_id: string
          event_type: string
          event_payload: Json
          matched_rule_id?: string | null
          status: 'matched' | 'unmatched' | 'error'
          action_log_id?: string | null
          created_at?: string
        }
        Update: {
          // Service-role dispatcher only | authenticated client has no UPDATE policy.
          // Append-only contract enforced at the SQL layer; this widening exists so
          // src/lib/manychat/dispatch-event.ts can flip status + link FKs after match.
          status?: 'matched' | 'unmatched' | 'error'
          action_log_id?: string | null
          matched_rule_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'manychat_events_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'manychat_events_channel_id_fkey'
            columns: ['channel_id']
            isOneToOne: false
            referencedRelation: 'manychat_channels'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'manychat_events_matched_rule_id_fkey'
            columns: ['matched_rule_id']
            isOneToOne: false
            referencedRelation: 'manychat_rules'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'manychat_events_action_log_id_fkey'
            columns: ['action_log_id']
            isOneToOne: false
            referencedRelation: 'action_logs'
            referencedColumns: ['id']
          }
        ]
      }
      tasks: {
        Row: {
          id: string
          org_id: string
          title: string
          description: string | null
          due_date: string | null
          priority: TaskPriority
          status: TaskStatus
          assigned_to: string | null
          entity_type: CrmEntityType | null
          entity_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          title: string
          description?: string | null
          due_date?: string | null
          priority?: TaskPriority
          status?: TaskStatus
          assigned_to?: string | null
          entity_type?: CrmEntityType | null
          entity_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          title?: string
          description?: string | null
          due_date?: string | null
          priority?: TaskPriority
          status?: TaskStatus
          assigned_to?: string | null
          entity_type?: CrmEntityType | null
          entity_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tasks_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      tenant_locations: {
        Row: {
          id: string
          org_id: string
          name: string
          address_line_1: string
          address_line_2: string | null
          city: string
          state: string | null
          postal_code: string | null
          country: string
          latitude: number | null
          longitude: number | null
          phone: string | null
          business_hours: Json
          notes: string | null
          is_default: boolean
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          address_line_1: string
          address_line_2?: string | null
          city: string
          state?: string | null
          postal_code?: string | null
          country?: string
          latitude?: number | null
          longitude?: number | null
          phone?: string | null
          business_hours?: Json
          notes?: string | null
          is_default?: boolean
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          address_line_1?: string
          address_line_2?: string | null
          city?: string
          state?: string | null
          postal_code?: string | null
          country?: string
          latitude?: number | null
          longitude?: number | null
          phone?: string | null
          business_hours?: Json
          notes?: string | null
          is_default?: boolean
          is_active?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tenant_locations_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      notes: {
        Row: {
          id: string
          org_id: string
          title: string | null
          content: string
          pinned: boolean
          entity_type: CrmEntityType | null
          entity_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          title?: string | null
          content: string
          pinned?: boolean
          entity_type?: CrmEntityType | null
          entity_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          title?: string | null
          content?: string
          pinned?: boolean
          entity_type?: CrmEntityType | null
          entity_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'notes_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notes_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      notifications: {
        Row: {
          id: string
          org_id: string
          user_id: string
          type: NotificationType
          payload: Json
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          user_id: string
          type: NotificationType
          payload?: Json
          read_at?: string | null
          created_at?: string
        }
        Update: {
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'notifications_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notifications_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      workflows: {
        Row: {
          id: string
          org_id: string
          name: string
          slug: string
          description: string | null
          is_active: boolean
          current_version_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
          kind: 'flow' | 'tool'
          tool_name: string | null
          trigger_type: 'tool_call' | 'event' | 'schedule' | 'manual' | 'webhook_url'
          trigger_config: Record<string, unknown>
          health_blocked: boolean
          health_blocked_reason: string | null
          legacy_tool_config_id: string | null
          folder_id: string | null
          position: number
          archived_at: string | null
          deleted_at: string | null
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          slug: string
          description?: string | null
          is_active?: boolean
          current_version_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          kind?: 'flow' | 'tool'
          tool_name?: string | null
          trigger_type?: 'tool_call' | 'event' | 'schedule' | 'manual' | 'webhook_url'
          trigger_config?: Record<string, unknown>
          health_blocked?: boolean
          health_blocked_reason?: string | null
          legacy_tool_config_id?: string | null
          folder_id?: string | null
          position?: number
          archived_at?: string | null
          deleted_at?: string | null
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          slug?: string
          description?: string | null
          is_active?: boolean
          current_version_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          kind?: 'flow' | 'tool'
          tool_name?: string | null
          trigger_type?: 'tool_call' | 'event' | 'schedule' | 'manual' | 'webhook_url'
          trigger_config?: Record<string, unknown>
          health_blocked?: boolean
          health_blocked_reason?: string | null
          legacy_tool_config_id?: string | null
          folder_id?: string | null
          position?: number
          archived_at?: string | null
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'workflows_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflows_current_version_id_fkey'
            columns: ['current_version_id']
            isOneToOne: false
            referencedRelation: 'workflow_versions'
            referencedColumns: ['id']
          }
        ]
      }
      workflow_versions: {
        Row: {
          id: string
          workflow_id: string
          version_number: number
          definition: Record<string, unknown>
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workflow_id: string
          version_number: number
          definition?: Record<string, unknown>
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          workflow_id?: string
          version_number?: number
          definition?: Record<string, unknown>
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_versions_workflow_id_fkey'
            columns: ['workflow_id']
            isOneToOne: false
            referencedRelation: 'workflows'
            referencedColumns: ['id']
          }
        ]
      }
      workflow_triggers: {
        Row: {
          id: string
          org_id: string
          workflow_id: string
          event_type: string
          filter: Record<string, unknown>
          schedule_cron: string | null
          enabled: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          workflow_id: string
          event_type: string
          filter?: Record<string, unknown>
          schedule_cron?: string | null
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          workflow_id?: string
          event_type?: string
          filter?: Record<string, unknown>
          schedule_cron?: string | null
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      workflow_runs: {
        Row: {
          id: string
          org_id: string
          workflow_id: string
          workflow_version_id: string | null
          trigger_type: string
          trigger_payload: Record<string, unknown>
          status: string
          state: Record<string, unknown>
          started_at: string | null
          ended_at: string | null
          error: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          workflow_id: string
          workflow_version_id?: string | null
          trigger_type?: string
          trigger_payload?: Record<string, unknown>
          status?: string
          state?: Record<string, unknown>
          started_at?: string | null
          ended_at?: string | null
          error?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          workflow_id?: string
          workflow_version_id?: string | null
          trigger_type?: string
          trigger_payload?: Record<string, unknown>
          status?: string
          state?: Record<string, unknown>
          started_at?: string | null
          ended_at?: string | null
          error?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      workflow_run_steps: {
        Row: {
          id: string
          run_id: string
          step_id: string
          node_id: string
          node_type: string
          status: string
          input: Record<string, unknown>
          output: Record<string, unknown>
          error: string | null
          started_at: string | null
          ended_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          run_id: string
          step_id: string
          node_id: string
          node_type: string
          status?: string
          input?: Record<string, unknown>
          output?: Record<string, unknown>
          error?: string | null
          started_at?: string | null
          ended_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          run_id?: string
          step_id?: string
          node_id?: string
          node_type?: string
          status?: string
          input?: Record<string, unknown>
          output?: Record<string, unknown>
          error?: string | null
          started_at?: string | null
          ended_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      copilot_conversations: {
        Row: {
          id: string
          org_id: string
          title: string
          visibility: string
          started_at: string
          ended_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          title?: string
          visibility?: string
          started_at?: string
          ended_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          title?: string
          visibility?: string
          started_at?: string
          ended_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      copilot_messages: {
        Row: {
          id: string
          conversation_id: string
          role: string
          parts: Record<string, unknown>[]
          metadata: Record<string, unknown>
          created_at: string
        }
        Insert: {
          id?: string
          conversation_id: string
          role: string
          parts?: Record<string, unknown>[]
          metadata?: Record<string, unknown>
          created_at?: string
        }
        Update: {
          id?: string
          conversation_id?: string
          role?: string
          parts?: Record<string, unknown>[]
          metadata?: Record<string, unknown>
          created_at?: string
        }
        Relationships: []
      }
      copilot_runs: {
        Row: {
          id: string
          org_id: string
          conversation_id: string
          provider: string
          model: string
          input_tokens: number
          output_tokens: number
          estimated_cost_usd: number
          status: string
          error: string | null
          started_at: string
          ended_at: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          conversation_id: string
          provider: string
          model: string
          input_tokens?: number
          output_tokens?: number
          estimated_cost_usd?: number
          status?: string
          error?: string | null
          started_at?: string
          ended_at?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          conversation_id?: string
          provider?: string
          model?: string
          input_tokens?: number
          output_tokens?: number
          estimated_cost_usd?: number
          status?: string
          error?: string | null
          started_at?: string
          ended_at?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      copilot_tool_calls: {
        Row: {
          id: string
          run_id: string
          tool_name: string
          input: Record<string, unknown>
          output: Record<string, unknown> | null
          error: string | null
          status: string
          duration_ms: number
          created_at: string
        }
        Insert: {
          id?: string
          run_id: string
          tool_name: string
          input?: Record<string, unknown>
          output?: Record<string, unknown> | null
          error?: string | null
          status?: string
          duration_ms?: number
          created_at?: string
        }
        Update: {
          id?: string
          run_id?: string
          tool_name?: string
          input?: Record<string, unknown>
          output?: Record<string, unknown> | null
          error?: string | null
          status?: string
          duration_ms?: number
          created_at?: string
        }
        Relationships: []
      }
      whatsapp_providers: {
        Row: {
          id: string
          org_id: string
          provider: 'evolution' | 'zapi' | 'wapi'
          display_name: string
          phone_number: string | null
          status: 'disconnected' | 'connecting' | 'connected' | 'qr_pending' | 'error'
          is_active: boolean
          config_encrypted: string
          webhook_secret_encrypted: string | null
          last_error: string | null
          connected_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          provider: 'evolution' | 'zapi' | 'wapi'
          display_name?: string
          phone_number?: string | null
          status?: 'disconnected' | 'connecting' | 'connected' | 'qr_pending' | 'error'
          is_active?: boolean
          config_encrypted: string
          webhook_secret_encrypted?: string | null
          last_error?: string | null
          connected_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          display_name?: string
          phone_number?: string | null
          status?: 'disconnected' | 'connecting' | 'connected' | 'qr_pending' | 'error'
          is_active?: boolean
          config_encrypted?: string
          webhook_secret_encrypted?: string | null
          last_error?: string | null
          connected_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'whatsapp_providers_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      integration_health_checks: {
        Row: {
          id: string
          integration_id: string
          organization_id: string
          status: 'connected' | 'degraded' | 'disconnected'
          latency_ms: number | null
          error: string | null
          checked_at: string
        }
        Insert: {
          id?: string
          integration_id: string
          organization_id: string
          status: 'connected' | 'degraded' | 'disconnected'
          latency_ms?: number | null
          error?: string | null
          checked_at?: string
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'integration_health_checks_integration_id_fkey'
            columns: ['integration_id']
            isOneToOne: false
            referencedRelation: 'integrations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'integration_health_checks_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      conversation_reads: {
        Row: {
          conversation_id: string
          user_id: string
          read_at: string
        }
        Insert: {
          conversation_id: string
          user_id: string
          read_at?: string
        }
        Update: {
          read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'conversation_reads_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'conversations'
            referencedColumns: ['id']
          }
        ]
      }
      conversation_labels: {
        Row: {
          id: string
          org_id: string
          name: string
          color: string
          position: number
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          color?: string
          position?: number
          created_at?: string
        }
        Update: {
          name?: string
          color?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: 'conversation_labels_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      conversation_label_assignments: {
        Row: {
          conversation_id: string
          label_id: string
          created_at: string
        }
        Insert: {
          conversation_id: string
          label_id: string
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'conversation_label_assignments_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'conversations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'conversation_label_assignments_label_id_fkey'
            columns: ['label_id']
            isOneToOne: false
            referencedRelation: 'conversation_labels'
            referencedColumns: ['id']
          }
        ]
      }
      workflow_folders: {
        Row: {
          id: string
          org_id: string
          name: string
          color: string | null
          icon: string | null
          parent_id: string | null
          position: number
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          color?: string | null
          icon?: string | null
          parent_id?: string | null
          position?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          color?: string | null
          icon?: string | null
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_folders_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          }
        ]
      }
      scheduled_opportunity_ticks: {
        Row: {
          id: string
          org_id: string
          workflow_id: string
          opportunity_id: string
          event_type: string
          fire_at: string
          fired: boolean
          fired_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          workflow_id: string
          opportunity_id: string
          event_type: string
          fire_at: string
          fired?: boolean
          fired_at?: string | null
          created_at?: string
        }
        Update: {
          fired?: boolean
          fired_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'scheduled_opportunity_ticks_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'scheduled_opportunity_ticks_workflow_id_fkey'
            columns: ['workflow_id']
            isOneToOne: false
            referencedRelation: 'workflows'
            referencedColumns: ['id']
          }
        ]
      }
      telegram_bots: {
        Row: {
          id: string
          org_id: string
          bot_token_encrypted: string
          bot_username: string | null
          bot_name: string | null
          notification_chat_ids: string[]
          automation_enabled: boolean
          agent_id: string | null
          is_active: boolean
          webhook_set: boolean
          last_error: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          bot_token_encrypted: string
          bot_username?: string | null
          bot_name?: string | null
          notification_chat_ids?: string[]
          automation_enabled?: boolean
          agent_id?: string | null
          is_active?: boolean
          webhook_set?: boolean
          last_error?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          bot_token_encrypted?: string
          bot_username?: string | null
          bot_name?: string | null
          notification_chat_ids?: string[]
          automation_enabled?: boolean
          agent_id?: string | null
          is_active?: boolean
          webhook_set?: boolean
          last_error?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'telegram_bots_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'telegram_bots_agent_id_fkey'
            columns: ['agent_id']
            isOneToOne: false
            referencedRelation: 'agents'
            referencedColumns: ['id']
          }
        ]
      }
    }
    Views: Record<string, never>
    Functions: {
      get_current_org_id: {
        Args: Record<string, never>
        Returns: string | null
      }
      get_org_member_profiles: {
        Args: {
          p_org_id: string
          p_page?: number
          p_per_page?: number
        }
        Returns: Array<{
          id: string
          user_id: string
          role: string
          joined_at: string
          email: string | null
          phone: string | null
          full_name: string | null
          total_count: number
        }>
      }
      match_documents: {
        Args: {
          query_embedding: number[]
          filter?: Json
        }
        Returns: Array<{
          id: number
          content: string
          metadata: Json
          similarity: number
        }>
      }
    }
    Enums: {
      user_role: UserRole
      action_type: 'send_email' | 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'knowledge_base' | 'custom_webhook' | 'manychat_set_field' | 'manychat_add_tag' | 'manychat_trigger_flow' | 'manychat_send_message' | 'google_contacts_create' | 'google_contacts_update' | 'google_contacts_find' | 'google_contacts_delete' | 'send_whatsapp_message' | 'send_whatsapp_mention_all' | 'send_telegram_notification' | 'pipeline_move_opportunity' | 'pipeline_update_opportunity' | 'pipeline_mark_won' | 'pipeline_mark_lost' | 'pipeline_add_note' | 'pipeline_assign_user' | 'pipeline_create_opportunity' | 'create_task' | 'create_note'
      integration_provider: 'gohighlevel' | 'twilio' | 'calcom' | 'custom_webhook' | 'openai' | 'anthropic' | 'openrouter' | 'vapi' | 'manychat' | 'google_contacts' | 'google_calendar' | 'telegram'
      // v2.0 (Phase 33) | agent runtime enums (migrations 034, 037)
      agent_channel: AgentChannel
      agent_invocation_status: AgentInvocationStatus
      agent_invocation_mode: AgentInvocationMode
      // v2.5 � tasks & notes enums
      task_priority: TaskPriority
      task_status: TaskStatus
      crm_entity_type: CrmEntityType
    }
  }
}

