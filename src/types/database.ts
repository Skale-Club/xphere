// Database type definitions for Opps
// Auto-generated shape â€” replace with Supabase CLI output after applying migrations:
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

export type CampaignStatus = 'draft' | 'scheduled' | 'in_progress' | 'paused' | 'completed' | 'stopped'
export type CampaignContactStatus = 'pending' | 'calling' | 'completed' | 'failed' | 'no_answer'

export type ConversationChannel = 'widget' | 'messenger' | 'instagram'
export type MetaChannelType = 'messenger' | 'instagram'

// v2.0 (Phase 33) â€” agent runtime enums
export type AgentChannel = 'web_widget' | 'whatsapp' | 'messenger' | 'instagram' | 'manychat' | 'telegram' | 'sms'
export type AgentInvocationStatus = 'success' | 'error' | 'aborted' | 'skipped' | 'denied' | 'running'
export type AgentInvocationMode = 'production' | 'playground'

// v2.1 â€” contacts (CRM) source enum
export type ContactSource = 'manual' | 'whatsapp' | 'sms' | 'instagram' | 'csv_import' | 'ghl_sync'

// v2.1 â€” call system (SEED-007)
export type CallRoutingMode = 'phone_forward' | 'sip' | 'browser'
export type CallDirection = 'inbound' | 'outbound'

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
          provider: 'gohighlevel' | 'twilio' | 'calcom' | 'custom_webhook' | 'openai' | 'anthropic' | 'openrouter' | 'vapi' | 'manychat' | 'google_contacts'
          name: string
          encrypted_api_key: string
          key_hint: string | null
          location_id: string | null
          config: Json
          is_active: boolean
          manychat_channel_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          provider: 'gohighlevel' | 'twilio' | 'calcom' | 'custom_webhook' | 'openai' | 'anthropic' | 'openrouter' | 'vapi' | 'manychat' | 'google_contacts'
          name: string
          encrypted_api_key: string
          key_hint?: string | null
          location_id?: string | null
          config?: Json
          is_active?: boolean
          manychat_channel_id?: string | null
          created_at?: string
          updated_at?: string
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
      tool_configs: {
        Row: {
          id: string
          organization_id: string
          integration_id: string | null
          tool_name: string
          action_type: 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'knowledge_base' | 'custom_webhook' | 'manychat_set_field' | 'manychat_add_tag' | 'manychat_trigger_flow' | 'manychat_send_message' | 'google_contacts_create' | 'google_contacts_update' | 'google_contacts_find' | 'google_contacts_delete' | 'send_whatsapp_message' | 'send_whatsapp_mention_all'
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
          action_type: 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'knowledge_base' | 'custom_webhook' | 'manychat_set_field' | 'manychat_add_tag' | 'manychat_trigger_flow' | 'manychat_send_message' | 'google_contacts_create' | 'google_contacts_update' | 'google_contacts_find' | 'google_contacts_delete' | 'send_whatsapp_message' | 'send_whatsapp_mention_all'
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
          action_type?: 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'knowledge_base' | 'custom_webhook' | 'manychat_set_field' | 'manychat_add_tag' | 'manychat_trigger_flow' | 'manychat_send_message' | 'google_contacts_create' | 'google_contacts_update' | 'google_contacts_find' | 'google_contacts_delete' | 'send_whatsapp_message' | 'send_whatsapp_mention_all'
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
          // v2.0 (Phase 33, migration 037 â€” OBS-02 additive): NULL = legacy v1.x action
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
      // v2.0 (Phase 33) â€” agent runtime tables (migrations 034-038)
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
          tool_config_id: string
          allowed_channels: AgentChannel[] | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          agent_id: string
          tool_config_id: string
          allowed_channels?: AgentChannel[] | null
          created_at?: string
        }
        Update: {
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
        }
        Insert: {
          id?: string
          conversation_id: string
          org_id: string
          role: string
          content: string
          created_at?: string
          metadata?: Record<string, unknown> | null
        }
        Update: {
          role?: string
          content?: string
          metadata?: Record<string, unknown> | null
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
          name: string | null
          phone: string | null
          email: string | null
          company: string | null
          notes: string | null
          tags: string[]
          custom_fields: Record<string, unknown>
          source: ContactSource
          external_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name?: string | null
          phone?: string | null
          email?: string | null
          company?: string | null
          notes?: string | null
          tags?: string[]
          custom_fields?: Record<string, unknown>
          source?: ContactSource
          external_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string | null
          phone?: string | null
          email?: string | null
          company?: string | null
          notes?: string | null
          tags?: string[]
          custom_fields?: Record<string, unknown>
          source?: ContactSource
          external_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'contacts_org_id_fkey'
            columns: ['org_id']
            isOneToOne: false
            referencedRelation: 'organizations'
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
      campaigns: {
        Row: {
          id: string
          organization_id: string
          name: string
          vapi_assistant_id: string
          vapi_phone_number_id: string
          vapi_campaign_id: string | null
          status: CampaignStatus
          scheduled_start_at: string | null
          calls_per_minute: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          vapi_assistant_id: string
          vapi_phone_number_id: string
          vapi_campaign_id?: string | null
          status?: CampaignStatus
          scheduled_start_at?: string | null
          calls_per_minute?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          vapi_campaign_id?: string | null
          status?: CampaignStatus
          scheduled_start_at?: string | null
          calls_per_minute?: number
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
          // v2.0 (Phase 33, migration 039 â€” CHAN-06): NULL = legacy tool_config_id dispatch
          agent_id: string | null
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
          org_id?: string       // set by RLS via get_current_org_id() â€” do not pass manually
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
          // v2.0 (Phase 33, migration 039 â€” CHAN-06): NULL = legacy tool_config_id dispatch
          agent_id: string | null
        }
        Insert: {
          id?: string
          org_id?: string       // set by RLS via get_current_org_id() â€” do not pass manually
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
          // Service-role dispatcher only â€” authenticated client has no UPDATE policy.
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
    }
    Views: Record<string, never>
    Functions: {
      get_current_org_id: {
        Args: Record<string, never>
        Returns: string | null
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
      action_type: 'create_contact' | 'get_availability' | 'create_appointment' | 'send_sms' | 'knowledge_base' | 'custom_webhook' | 'manychat_set_field' | 'manychat_add_tag' | 'manychat_trigger_flow' | 'manychat_send_message' | 'google_contacts_create' | 'google_contacts_update' | 'google_contacts_find' | 'google_contacts_delete' | 'send_whatsapp_message' | 'send_whatsapp_mention_all'
      integration_provider: 'gohighlevel' | 'twilio' | 'calcom' | 'custom_webhook' | 'openai' | 'anthropic' | 'openrouter' | 'vapi' | 'manychat' | 'google_contacts'
      // v2.0 (Phase 33) â€” agent runtime enums (migrations 034, 037)
      agent_channel: AgentChannel
      agent_invocation_status: AgentInvocationStatus
      agent_invocation_mode: AgentInvocationMode
    }
  }
}

