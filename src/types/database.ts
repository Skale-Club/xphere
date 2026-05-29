export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      _legacy_tool_configs: {
        Row: {
          action_type: Database["public"]["Enums"]["action_type"]
          config: Json
          created_at: string
          fallback_message: string
          folder_id: string | null
          id: string
          integration_id: string | null
          is_active: boolean
          labels: string[]
          organization_id: string
          tool_name: string
          updated_at: string
        }
        Insert: {
          action_type: Database["public"]["Enums"]["action_type"]
          config?: Json
          created_at?: string
          fallback_message: string
          folder_id?: string | null
          id?: string
          integration_id?: string | null
          is_active?: boolean
          labels?: string[]
          organization_id: string
          tool_name: string
          updated_at?: string
        }
        Update: {
          action_type?: Database["public"]["Enums"]["action_type"]
          config?: Json
          created_at?: string
          fallback_message?: string
          folder_id?: string | null
          id?: string
          integration_id?: string | null
          is_active?: boolean
          labels?: string[]
          organization_id?: string
          tool_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_configs_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "tool_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_configs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      _location_kinds: {
        Row: {
          kind: string
        }
        Insert: {
          kind: string
        }
        Update: {
          kind?: string
        }
        Relationships: []
      }
      accounts: {
        Row: {
          address: string | null
          assigned_to: string | null
          avatar_url: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          domain: string | null
          external_id: string | null
          id: string
          industry: string | null
          name: string
          notes: string | null
          org_id: string
          phone: string | null
          size: string | null
          source: string
          tags: string[]
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          assigned_to?: string | null
          avatar_url?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          domain?: string | null
          external_id?: string | null
          id?: string
          industry?: string | null
          name: string
          notes?: string | null
          org_id: string
          phone?: string | null
          size?: string | null
          source?: string
          tags?: string[]
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          assigned_to?: string | null
          avatar_url?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          domain?: string | null
          external_id?: string | null
          id?: string
          industry?: string | null
          name?: string
          notes?: string | null
          org_id?: string
          phone?: string | null
          size?: string | null
          source?: string
          tags?: string[]
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      action_logs: {
        Row: {
          agent_invocation_id: string | null
          created_at: string
          error_detail: string | null
          execution_ms: number
          id: string
          organization_id: string
          request_payload: Json
          response_payload: Json
          status: string
          tool_config_id: string | null
          tool_name: string
          trace_id: string | null
          vapi_call_id: string
        }
        Insert: {
          agent_invocation_id?: string | null
          created_at?: string
          error_detail?: string | null
          execution_ms: number
          id?: string
          organization_id: string
          request_payload?: Json
          response_payload?: Json
          status: string
          tool_config_id?: string | null
          tool_name: string
          trace_id?: string | null
          vapi_call_id: string
        }
        Update: {
          agent_invocation_id?: string | null
          created_at?: string
          error_detail?: string | null
          execution_ms?: number
          id?: string
          organization_id?: string
          request_payload?: Json
          response_payload?: Json
          status?: string
          tool_config_id?: string | null
          tool_name?: string
          trace_id?: string | null
          vapi_call_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_logs_agent_invocation_id_fkey"
            columns: ["agent_invocation_id"]
            isOneToOne: false
            referencedRelation: "agent_invocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_logs_tool_config_id_fkey"
            columns: ["tool_config_id"]
            isOneToOne: false
            referencedRelation: "_legacy_tool_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_audits: {
        Row: {
          created_at: string
          id: string
          journey_id: string
          leads_total: number
          learnings: string | null
          misses: string | null
          opportunities_total: number
          org_id: string
          period_from: string
          period_to: string
          period_type: string
          plans_invalidated: Json
          plans_validated: Json
          recommendations: string | null
          revenue_total: number
          spend_total: number
          status: string
          summary: string | null
          title: string
          updated_at: string
          wins: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          journey_id: string
          leads_total?: number
          learnings?: string | null
          misses?: string | null
          opportunities_total?: number
          org_id: string
          period_from: string
          period_to: string
          period_type: string
          plans_invalidated?: Json
          plans_validated?: Json
          recommendations?: string | null
          revenue_total?: number
          spend_total?: number
          status?: string
          summary?: string | null
          title: string
          updated_at?: string
          wins?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          journey_id?: string
          leads_total?: number
          learnings?: string | null
          misses?: string | null
          opportunities_total?: number
          org_id?: string
          period_from?: string
          period_to?: string
          period_type?: string
          plans_invalidated?: Json
          plans_validated?: Json
          recommendations?: string | null
          revenue_total?: number
          spend_total?: number
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
          wins?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ads_audits_journey_id_fkey"
            columns: ["journey_id"]
            isOneToOne: false
            referencedRelation: "ads_journey"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_audits_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_connections: {
        Row: {
          ad_account_id: string
          ad_account_name: string | null
          connection_error: string | null
          created_at: string
          encrypted_access_token: string
          id: string
          meta_app_scoped_user_id: string | null
          org_id: string
          platform: string
          status: string
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          ad_account_id: string
          ad_account_name?: string | null
          connection_error?: string | null
          created_at?: string
          encrypted_access_token: string
          id?: string
          meta_app_scoped_user_id?: string | null
          org_id: string
          platform: string
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          ad_account_id?: string
          ad_account_name?: string | null
          connection_error?: string | null
          created_at?: string
          encrypted_access_token?: string
          id?: string
          meta_app_scoped_user_id?: string | null
          org_id?: string
          platform?: string
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_executions: {
        Row: {
          after_value: string | null
          before_value: string | null
          campaign_id: string | null
          campaign_name: string | null
          created_at: string
          description: string | null
          executed_at: string
          executed_by_ai: boolean
          id: string
          journey_id: string
          org_id: string
          plan_id: string | null
          platform: string | null
          title: string
          type: string
        }
        Insert: {
          after_value?: string | null
          before_value?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          created_at?: string
          description?: string | null
          executed_at?: string
          executed_by_ai?: boolean
          id?: string
          journey_id: string
          org_id: string
          plan_id?: string | null
          platform?: string | null
          title: string
          type: string
        }
        Update: {
          after_value?: string | null
          before_value?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          created_at?: string
          description?: string | null
          executed_at?: string
          executed_by_ai?: boolean
          id?: string
          journey_id?: string
          org_id?: string
          plan_id?: string | null
          platform?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_executions_journey_id_fkey"
            columns: ["journey_id"]
            isOneToOne: false
            referencedRelation: "ads_journey"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_executions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_executions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "ads_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_journey: {
        Row: {
          created_at: string
          current_phase: string | null
          id: string
          org_id: string
          started_at: string
          status: string
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_phase?: string | null
          id?: string
          org_id: string
          started_at?: string
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_phase?: string | null
          id?: string
          org_id?: string
          started_at?: string
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_journey_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_memories: {
        Row: {
          campaign_id: string | null
          campaign_name: string | null
          confidence: number
          content: string
          created_at: string
          id: string
          journey_id: string
          metadata: Json
          org_id: string
          platform: string | null
          proposed: boolean
          source: string
          status: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          campaign_id?: string | null
          campaign_name?: string | null
          confidence?: number
          content: string
          created_at?: string
          id?: string
          journey_id: string
          metadata?: Json
          org_id: string
          platform?: string | null
          proposed?: boolean
          source: string
          status?: string
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string | null
          campaign_name?: string | null
          confidence?: number
          content?: string
          created_at?: string
          id?: string
          journey_id?: string
          metadata?: Json
          org_id?: string
          platform?: string | null
          proposed?: boolean
          source?: string
          status?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_memories_journey_id_fkey"
            columns: ["journey_id"]
            isOneToOne: false
            referencedRelation: "ads_journey"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_memories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ads_plans: {
        Row: {
          created_at: string
          deadline: string | null
          description: string | null
          id: string
          journey_id: string
          metric: string | null
          org_id: string
          platform: string | null
          status: string
          target_value: number | null
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deadline?: string | null
          description?: string | null
          id?: string
          journey_id: string
          metric?: string | null
          org_id: string
          platform?: string | null
          status?: string
          target_value?: number | null
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deadline?: string | null
          description?: string | null
          id?: string
          journey_id?: string
          metric?: string | null
          org_id?: string
          platform?: string | null
          status?: string
          target_value?: number | null
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ads_plans_journey_id_fkey"
            columns: ["journey_id"]
            isOneToOne: false
            referencedRelation: "ads_journey"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_plans_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_channel_defaults: {
        Row: {
          agent_id: string
          channel: Database["public"]["Enums"]["agent_channel"]
          created_at: string
          id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          channel: Database["public"]["Enums"]["agent_channel"]
          created_at?: string
          id?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          channel?: Database["public"]["Enums"]["agent_channel"]
          created_at?: string
          id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_channel_defaults_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_channel_defaults_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_invocations: {
        Row: {
          agent_id: string
          assistant_reply: string | null
          channel: Database["public"]["Enums"]["agent_channel"]
          conversation_id: string | null
          cost_usd: number | null
          created_at: string
          depth: number
          duration_ms: number | null
          error_detail: string | null
          id: string
          mode: Database["public"]["Enums"]["agent_invocation_mode"]
          model: string | null
          organization_id: string
          parent_invocation_id: string | null
          partner_calls: Json
          session_id: string | null
          status: Database["public"]["Enums"]["agent_invocation_status"]
          tokens_in: number | null
          tokens_out: number | null
          tool_calls: Json
          trace_id: string
          user_message: string | null
        }
        Insert: {
          agent_id: string
          assistant_reply?: string | null
          channel: Database["public"]["Enums"]["agent_channel"]
          conversation_id?: string | null
          cost_usd?: number | null
          created_at?: string
          depth?: number
          duration_ms?: number | null
          error_detail?: string | null
          id?: string
          mode?: Database["public"]["Enums"]["agent_invocation_mode"]
          model?: string | null
          organization_id: string
          parent_invocation_id?: string | null
          partner_calls?: Json
          session_id?: string | null
          status: Database["public"]["Enums"]["agent_invocation_status"]
          tokens_in?: number | null
          tokens_out?: number | null
          tool_calls?: Json
          trace_id: string
          user_message?: string | null
        }
        Update: {
          agent_id?: string
          assistant_reply?: string | null
          channel?: Database["public"]["Enums"]["agent_channel"]
          conversation_id?: string | null
          cost_usd?: number | null
          created_at?: string
          depth?: number
          duration_ms?: number | null
          error_detail?: string | null
          id?: string
          mode?: Database["public"]["Enums"]["agent_invocation_mode"]
          model?: string | null
          organization_id?: string
          parent_invocation_id?: string | null
          partner_calls?: Json
          session_id?: string | null
          status?: Database["public"]["Enums"]["agent_invocation_status"]
          tokens_in?: number | null
          tokens_out?: number | null
          tool_calls?: Json
          trace_id?: string
          user_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_invocations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_invocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_invocations_parent_invocation_id_fkey"
            columns: ["parent_invocation_id"]
            isOneToOne: false
            referencedRelation: "agent_invocations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_model_pricing: {
        Row: {
          input_per_1m_usd: number
          model: string
          notes: string | null
          output_per_1m_usd: number
          source: string
          updated_at: string
        }
        Insert: {
          input_per_1m_usd: number
          model: string
          notes?: string | null
          output_per_1m_usd: number
          source: string
          updated_at?: string
        }
        Update: {
          input_per_1m_usd?: number
          model?: string
          notes?: string | null
          output_per_1m_usd?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      agent_partners: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          invocation_description: string
          organization_id: string
          partner_agent_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          invocation_description: string
          organization_id: string
          partner_agent_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          invocation_description?: string
          organization_id?: string
          partner_agent_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_partners_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_partners_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_partners_partner_agent_id_fkey"
            columns: ["partner_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_prompt_versions: {
        Row: {
          agent_id: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          system_prompt: string
          version: number
        }
        Insert: {
          agent_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          system_prompt: string
          version: number
        }
        Update: {
          agent_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          system_prompt?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_prompt_versions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_prompt_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tools: {
        Row: {
          agent_id: string
          allowed_channels:
            | Database["public"]["Enums"]["agent_channel"][]
            | null
          created_at: string
          id: string
          organization_id: string
          tool_config_id: string | null
          workflow_id: string | null
        }
        Insert: {
          agent_id: string
          allowed_channels?:
            | Database["public"]["Enums"]["agent_channel"][]
            | null
          created_at?: string
          id?: string
          organization_id: string
          tool_config_id?: string | null
          workflow_id?: string | null
        }
        Update: {
          agent_id?: string
          allowed_channels?:
            | Database["public"]["Enums"]["agent_channel"][]
            | null
          created_at?: string
          id?: string
          organization_id?: string
          tool_config_id?: string | null
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_tools_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tools_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tools_tool_config_id_fkey"
            columns: ["tool_config_id"]
            isOneToOne: false
            referencedRelation: "_legacy_tool_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tools_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          active_prompt_version_id: string | null
          allowed_channels: Database["public"]["Enums"]["agent_channel"][]
          channel_overrides: Json
          created_at: string
          created_by: string | null
          description: string | null
          fallback_message: string
          id: string
          is_active: boolean
          kb_scope: string[] | null
          max_history: number
          max_tokens: number | null
          model: string
          name: string
          organization_id: string
          slug: string
          system_prompt: string
          temperature: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active_prompt_version_id?: string | null
          allowed_channels?: Database["public"]["Enums"]["agent_channel"][]
          channel_overrides?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          fallback_message?: string
          id?: string
          is_active?: boolean
          kb_scope?: string[] | null
          max_history?: number
          max_tokens?: number | null
          model?: string
          name: string
          organization_id: string
          slug: string
          system_prompt: string
          temperature?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active_prompt_version_id?: string | null
          allowed_channels?: Database["public"]["Enums"]["agent_channel"][]
          channel_overrides?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          fallback_message?: string
          id?: string
          is_active?: boolean
          kb_scope?: string[] | null
          max_history?: number
          max_tokens?: number | null
          model?: string
          name?: string
          organization_id?: string
          slug?: string
          system_prompt?: string
          temperature?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agents_active_prompt_version_id_fkey"
            columns: ["active_prompt_version_id"]
            isOneToOne: false
            referencedRelation: "agent_prompt_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_mappings: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string | null
          organization_id: string
          updated_at: string
          vapi_assistant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string | null
          organization_id: string
          updated_at?: string
          vapi_assistant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string | null
          organization_id?: string
          updated_at?: string
          vapi_assistant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_mappings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_schedules: {
        Row: {
          automation_key: string
          created_at: string
          id: string
          interval_minutes: number
          is_active: boolean
          last_run_at: string | null
          last_run_result: Json | null
          last_run_status: string | null
          next_run_at: string
          updated_at: string
        }
        Insert: {
          automation_key: string
          created_at?: string
          id?: string
          interval_minutes: number
          is_active?: boolean
          last_run_at?: string | null
          last_run_result?: Json | null
          last_run_status?: string | null
          next_run_at: string
          updated_at?: string
        }
        Update: {
          automation_key?: string
          created_at?: string
          id?: string
          interval_minutes?: number
          is_active?: boolean
          last_run_at?: string | null
          last_run_result?: Json | null
          last_run_status?: string | null
          next_run_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          booker_email: string
          booker_name: string
          booker_phone: string | null
          booker_timezone: string
          cancel_token: string
          created_at: string
          end_at: string
          event_type_id: string
          id: string
          linked_contact_id: string | null
          location_data: Json
          location_kind: string | null
          meeting_phone: string | null
          meeting_url: string | null
          notes: string | null
          org_id: string
          start_at: string
          status: string
          updated_at: string
        }
        Insert: {
          booker_email: string
          booker_name: string
          booker_phone?: string | null
          booker_timezone?: string
          cancel_token?: string
          created_at?: string
          end_at: string
          event_type_id: string
          id?: string
          linked_contact_id?: string | null
          location_data?: Json
          location_kind?: string | null
          meeting_phone?: string | null
          meeting_url?: string | null
          notes?: string | null
          org_id: string
          start_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          booker_email?: string
          booker_name?: string
          booker_phone?: string | null
          booker_timezone?: string
          cancel_token?: string
          created_at?: string
          end_at?: string
          event_type_id?: string
          id?: string
          linked_contact_id?: string | null
          location_data?: Json
          location_kind?: string | null
          meeting_phone?: string | null
          meeting_url?: string | null
          notes?: string | null
          org_id?: string
          start_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_event_type_id_fkey"
            columns: ["event_type_id"]
            isOneToOne: false
            referencedRelation: "event_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_linked_contact_id_fkey"
            columns: ["linked_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      call_logs: {
        Row: {
          call_sid: string
          contact_id: string | null
          created_at: string
          created_by: string | null
          direction: string
          duration_seconds: number | null
          ended_at: string | null
          from_number: string | null
          id: string
          notes: string | null
          opportunity_id: string | null
          org_id: string
          phone_number_id: string | null
          recording_duration: number | null
          recording_url: string | null
          routing_mode: string | null
          started_at: string | null
          status: string | null
          to_number: string | null
        }
        Insert: {
          call_sid: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          direction: string
          duration_seconds?: number | null
          ended_at?: string | null
          from_number?: string | null
          id?: string
          notes?: string | null
          opportunity_id?: string | null
          org_id: string
          phone_number_id?: string | null
          recording_duration?: number | null
          recording_url?: string | null
          routing_mode?: string | null
          started_at?: string | null
          status?: string | null
          to_number?: string | null
        }
        Update: {
          call_sid?: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string
          duration_seconds?: number | null
          ended_at?: string | null
          from_number?: string | null
          id?: string
          notes?: string | null
          opportunity_id?: string | null
          org_id?: string
          phone_number_id?: string | null
          recording_duration?: number | null
          recording_url?: string | null
          routing_mode?: string | null
          started_at?: string | null
          status?: string | null
          to_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "twilio_phone_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      call_settings: {
        Row: {
          created_at: string
          id: string
          org_id: string
          phone_forward: string | null
          record_calls: boolean
          routing_mode: string
          sip_password_encrypted: string | null
          sip_username: string | null
          twilio_client_identity: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          phone_forward?: string | null
          record_calls?: boolean
          routing_mode?: string
          sip_password_encrypted?: string | null
          sip_username?: string | null
          twilio_client_identity?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          phone_forward?: string | null
          record_calls?: boolean
          routing_mode?: string
          sip_password_encrypted?: string | null
          sip_username?: string | null
          twilio_client_identity?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          assistant_id: string | null
          call_type: string | null
          cost: number | null
          created_at: string
          customer_name: string | null
          customer_number: string | null
          duration_seconds: number | null
          ended_at: string | null
          ended_reason: string | null
          id: string
          organization_id: string
          started_at: string | null
          status: string | null
          summary: string | null
          transcript: string | null
          transcript_turns: Json
          vapi_call_id: string
        }
        Insert: {
          assistant_id?: string | null
          call_type?: string | null
          cost?: number | null
          created_at?: string
          customer_name?: string | null
          customer_number?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          ended_reason?: string | null
          id?: string
          organization_id: string
          started_at?: string | null
          status?: string | null
          summary?: string | null
          transcript?: string | null
          transcript_turns?: Json
          vapi_call_id: string
        }
        Update: {
          assistant_id?: string | null
          call_type?: string | null
          cost?: number | null
          created_at?: string
          customer_name?: string | null
          customer_number?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          ended_reason?: string | null
          id?: string
          organization_id?: string
          started_at?: string | null
          status?: string | null
          summary?: string | null
          transcript?: string | null
          transcript_turns?: Json
          vapi_call_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calls_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_contacts: {
        Row: {
          called_at: string | null
          campaign_id: string
          completed_at: string | null
          created_at: string
          custom_data: Json
          error_detail: string | null
          id: string
          name: string | null
          organization_id: string
          phone: string
          retry_count: number
          status: string
          updated_at: string
          vapi_call_id: string | null
        }
        Insert: {
          called_at?: string | null
          campaign_id: string
          completed_at?: string | null
          created_at?: string
          custom_data?: Json
          error_detail?: string | null
          id?: string
          name?: string | null
          organization_id: string
          phone: string
          retry_count?: number
          status?: string
          updated_at?: string
          vapi_call_id?: string | null
        }
        Update: {
          called_at?: string | null
          campaign_id?: string
          completed_at?: string | null
          created_at?: string
          custom_data?: Json
          error_detail?: string | null
          id?: string
          name?: string | null
          organization_id?: string
          phone?: string
          retry_count?: number
          status?: string
          updated_at?: string
          vapi_call_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_contacts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_recipients: {
        Row: {
          campaign_id: string
          contact_id: string | null
          cost_usd: number | null
          created_at: string
          error_message: string | null
          id: string
          message_type: string | null
          result: Json
          sent_at: string | null
          status: string
          updated_at: string
          wamid: string | null
        }
        Insert: {
          campaign_id: string
          contact_id?: string | null
          cost_usd?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          message_type?: string | null
          result?: Json
          sent_at?: string | null
          status?: string
          updated_at?: string
          wamid?: string | null
        }
        Update: {
          campaign_id?: string
          contact_id?: string | null
          cost_usd?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          message_type?: string | null
          result?: Json
          sent_at?: string | null
          status?: string
          updated_at?: string
          wamid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          audience_filter: Json
          calls_per_minute: number
          campaign_type: string
          channel: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          landing_page_url: string | null
          metrics: Json
          name: string
          organization_id: string
          scheduled_start_at: string | null
          started_at: string | null
          status: string
          template_config: Json
          updated_at: string
          utm_campaign_tag: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          vapi_assistant_id: string | null
          vapi_campaign_id: string | null
          vapi_phone_number_id: string | null
          whatsapp_template_id: string | null
          whatsapp_variable_mapping: Json | null
        }
        Insert: {
          audience_filter?: Json
          calls_per_minute?: number
          campaign_type?: string
          channel?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          landing_page_url?: string | null
          metrics?: Json
          name: string
          organization_id: string
          scheduled_start_at?: string | null
          started_at?: string | null
          status?: string
          template_config?: Json
          updated_at?: string
          utm_campaign_tag?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          vapi_assistant_id?: string | null
          vapi_campaign_id?: string | null
          vapi_phone_number_id?: string | null
          whatsapp_template_id?: string | null
          whatsapp_variable_mapping?: Json | null
        }
        Update: {
          audience_filter?: Json
          calls_per_minute?: number
          campaign_type?: string
          channel?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          landing_page_url?: string | null
          metrics?: Json
          name?: string
          organization_id?: string
          scheduled_start_at?: string | null
          started_at?: string | null
          status?: string
          template_config?: Json
          updated_at?: string
          utm_campaign_tag?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          vapi_assistant_id?: string | null
          vapi_campaign_id?: string | null
          vapi_phone_number_id?: string | null
          whatsapp_template_id?: string | null
          whatsapp_variable_mapping?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_whatsapp_template_id_fkey"
            columns: ["whatsapp_template_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_channel_identities: {
        Row: {
          contact_id: string
          created_at: string
          external_id: string
          id: string
          org_id: string
          provider: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          external_id: string
          id?: string
          org_id: string
          provider: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          external_id?: string
          id?: string
          org_id?: string
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_channel_identities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_channel_identities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_duplicate_audit: {
        Row: {
          cluster_id: string
          cluster_size: number
          contact_ids: string[]
          detected_at: string
          match_type: string
          normalized_value: string
          org_id: string
        }
        Insert: {
          cluster_id?: string
          cluster_size: number
          contact_ids: string[]
          detected_at?: string
          match_type: string
          normalized_value: string
          org_id: string
        }
        Update: {
          cluster_id?: string
          cluster_size?: number
          contact_ids?: string[]
          detected_at?: string
          match_type?: string
          normalized_value?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_duplicate_audit_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_import_errors: {
        Row: {
          created_at: string
          field: string | null
          id: string
          import_id: string
          message: string
          raw_row: Json
          row_number: number
        }
        Insert: {
          created_at?: string
          field?: string | null
          id?: string
          import_id: string
          message: string
          raw_row: Json
          row_number: number
        }
        Update: {
          created_at?: string
          field?: string | null
          id?: string
          import_id?: string
          message?: string
          raw_row?: Json
          row_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "contact_import_errors_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "contact_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_imports: {
        Row: {
          created_at: string
          created_by: string | null
          dedup_keys: string[] | null
          dedup_strategy: Database["public"]["Enums"]["contact_import_dedup_strategy"]
          default_assigned_to: string | null
          default_source: string | null
          default_tags: string[] | null
          error_rows: number | null
          error_summary: string | null
          filename: string
          finished_at: string | null
          id: string
          inserted_rows: number | null
          mapping: Json
          mime_type: string | null
          org_id: string
          processed_rows: number | null
          progress_percent: number | null
          size_bytes: number
          skipped_rows: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["contact_import_status"]
          status_message: string | null
          storage_path: string
          total_rows: number | null
          updated_at: string
          updated_rows: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dedup_keys?: string[] | null
          dedup_strategy?: Database["public"]["Enums"]["contact_import_dedup_strategy"]
          default_assigned_to?: string | null
          default_source?: string | null
          default_tags?: string[] | null
          error_rows?: number | null
          error_summary?: string | null
          filename: string
          finished_at?: string | null
          id?: string
          inserted_rows?: number | null
          mapping?: Json
          mime_type?: string | null
          org_id: string
          processed_rows?: number | null
          progress_percent?: number | null
          size_bytes: number
          skipped_rows?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["contact_import_status"]
          status_message?: string | null
          storage_path: string
          total_rows?: number | null
          updated_at?: string
          updated_rows?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dedup_keys?: string[] | null
          dedup_strategy?: Database["public"]["Enums"]["contact_import_dedup_strategy"]
          default_assigned_to?: string | null
          default_source?: string | null
          default_tags?: string[] | null
          error_rows?: number | null
          error_summary?: string | null
          filename?: string
          finished_at?: string | null
          id?: string
          inserted_rows?: number | null
          mapping?: Json
          mime_type?: string | null
          org_id?: string
          processed_rows?: number | null
          progress_percent?: number | null
          size_bytes?: number
          skipped_rows?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["contact_import_status"]
          status_message?: string | null
          storage_path?: string
          total_rows?: number | null
          updated_at?: string
          updated_rows?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_imports_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_merge_exclusions: {
        Row: {
          contact_id_a: string
          contact_id_b: string
          excluded_at: string
          excluded_by: string | null
          org_id: string
          reason: string | null
        }
        Insert: {
          contact_id_a: string
          contact_id_b: string
          excluded_at?: string
          excluded_by?: string | null
          org_id: string
          reason?: string | null
        }
        Update: {
          contact_id_a?: string
          contact_id_b?: string
          excluded_at?: string
          excluded_by?: string | null
          org_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_merge_exclusions_contact_id_a_fkey"
            columns: ["contact_id_a"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_merge_exclusions_contact_id_b_fkey"
            columns: ["contact_id_b"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_merge_exclusions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_merge_log: {
        Row: {
          affected_rows: Json | null
          archived_id: string
          cluster_id: string | null
          id: string
          merged_at: string
          merged_by: string | null
          org_id: string
          strategy: string
          survivor_id: string
        }
        Insert: {
          affected_rows?: Json | null
          archived_id: string
          cluster_id?: string | null
          id?: string
          merged_at?: string
          merged_by?: string | null
          org_id: string
          strategy: string
          survivor_id: string
        }
        Update: {
          affected_rows?: Json | null
          archived_id?: string
          cluster_id?: string | null
          id?: string
          merged_at?: string
          merged_by?: string | null
          org_id?: string
          strategy?: string
          survivor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_merge_log_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "contact_duplicate_audit"
            referencedColumns: ["cluster_id"]
          },
          {
            foreignKeyName: "contact_merge_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
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
        Update: {
          contact_id?: string
          tag_id?: string
          tagged_at?: string
          tagged_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_verifications: {
        Row: {
          contact_id: string
          id: string
          identifier_type: string
          identifier_value: string
          method: string
          org_id: string
          verified_at: string
          verified_by: string | null
        }
        Insert: {
          contact_id: string
          id?: string
          identifier_type: string
          identifier_value: string
          method: string
          org_id: string
          verified_at?: string
          verified_by?: string | null
        }
        Update: {
          contact_id?: string
          id?: string
          identifier_type?: string
          identifier_value?: string
          method?: string
          org_id?: string
          verified_at?: string
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_verifications_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_verifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          account_id: string | null
          avatar_url: string | null
          company: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          dnd_channels: string[]
          dnd_enabled: boolean
          dnd_note: string | null
          dnd_set_at: string | null
          dnd_set_by: string | null
          email: string | null
          email_normalized: string | null
          external_id: string | null
          first_name: string | null
          id: string
          identity_status: string
          last_name: string | null
          merged_into_contact_id: string | null
          name: string | null
          notes: string | null
          org_id: string
          phone: string | null
          phone_e164: string | null
          source: string
          tags: string[]
          updated_at: string
          whatsapp_opt_in: boolean
          whatsapp_opted_at: string | null
        }
        Insert: {
          account_id?: string | null
          avatar_url?: string | null
          company?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          dnd_channels?: string[]
          dnd_enabled?: boolean
          dnd_note?: string | null
          dnd_set_at?: string | null
          dnd_set_by?: string | null
          email?: string | null
          email_normalized?: string | null
          external_id?: string | null
          first_name?: string | null
          id?: string
          identity_status?: string
          last_name?: string | null
          merged_into_contact_id?: string | null
          name?: string | null
          notes?: string | null
          org_id: string
          phone?: string | null
          phone_e164?: string | null
          source?: string
          tags?: string[]
          updated_at?: string
          whatsapp_opt_in?: boolean
          whatsapp_opted_at?: string | null
        }
        Update: {
          account_id?: string | null
          avatar_url?: string | null
          company?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          dnd_channels?: string[]
          dnd_enabled?: boolean
          dnd_note?: string | null
          dnd_set_at?: string | null
          dnd_set_by?: string | null
          email?: string | null
          email_normalized?: string | null
          external_id?: string | null
          first_name?: string | null
          id?: string
          identity_status?: string
          last_name?: string | null
          merged_into_contact_id?: string | null
          name?: string | null
          notes?: string | null
          org_id?: string
          phone?: string | null
          phone_e164?: string | null
          source?: string
          tags?: string[]
          updated_at?: string
          whatsapp_opt_in?: boolean
          whatsapp_opted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_merged_into_contact_id_fkey"
            columns: ["merged_into_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_label_assignments: {
        Row: {
          conversation_id: string
          created_at: string
          label_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          label_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          label_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_label_assignments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_label_assignments_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "conversation_labels"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_labels: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          org_id: string
          position: number
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          org_id: string
          position?: number
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversation_labels_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_messages: {
        Row: {
          channel: string | null
          content: string
          conversation_id: string
          created_at: string
          email_cc: string | null
          email_delivery_status: string | null
          email_from: string | null
          email_message_id: string | null
          email_subject: string | null
          email_to: string | null
          id: string
          message_type: string
          metadata: Json | null
          org_id: string
          role: string
        }
        Insert: {
          channel?: string | null
          content: string
          conversation_id: string
          created_at?: string
          email_cc?: string | null
          email_delivery_status?: string | null
          email_from?: string | null
          email_message_id?: string | null
          email_subject?: string | null
          email_to?: string | null
          id?: string
          message_type?: string
          metadata?: Json | null
          org_id: string
          role: string
        }
        Update: {
          channel?: string | null
          content?: string
          conversation_id?: string
          created_at?: string
          email_cc?: string | null
          email_delivery_status?: string | null
          email_from?: string | null
          email_message_id?: string | null
          email_subject?: string | null
          email_to?: string | null
          id?: string
          message_type?: string
          metadata?: Json | null
          org_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_organization_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_session_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_reads: {
        Row: {
          conversation_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_reads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          agent_id: string | null
          assigned_user_id: string | null
          bot_status: string
          channel: string
          channel_metadata: Json
          contact_id: string | null
          created_at: string
          evolution_instance_id: string | null
          first_page_url: string | null
          id: string
          last_active_at: string
          last_inbound_at: string | null
          last_message: string | null
          last_message_at: string | null
          memory: Json
          org_id: string
          phone_number_id: string | null
          pinned: boolean | null
          priority: string | null
          session_key: string | null
          starred: boolean
          status: string
          updated_at: string
          visitor_email: string | null
          visitor_name: string | null
          visitor_phone: string | null
          wait_until: string | null
          widget_token: string
        }
        Insert: {
          agent_id?: string | null
          assigned_user_id?: string | null
          bot_status?: string
          channel?: string
          channel_metadata?: Json
          contact_id?: string | null
          created_at?: string
          evolution_instance_id?: string | null
          first_page_url?: string | null
          id?: string
          last_active_at?: string
          last_inbound_at?: string | null
          last_message?: string | null
          last_message_at?: string | null
          memory?: Json
          org_id: string
          phone_number_id?: string | null
          pinned?: boolean | null
          priority?: string | null
          session_key?: string | null
          starred?: boolean
          status?: string
          updated_at?: string
          visitor_email?: string | null
          visitor_name?: string | null
          visitor_phone?: string | null
          wait_until?: string | null
          widget_token: string
        }
        Update: {
          agent_id?: string | null
          assigned_user_id?: string | null
          bot_status?: string
          channel?: string
          channel_metadata?: Json
          contact_id?: string | null
          created_at?: string
          evolution_instance_id?: string | null
          first_page_url?: string | null
          id?: string
          last_active_at?: string
          last_inbound_at?: string | null
          last_message?: string | null
          last_message_at?: string | null
          memory?: Json
          org_id?: string
          phone_number_id?: string | null
          pinned?: boolean | null
          priority?: string | null
          session_key?: string | null
          starred?: boolean
          status?: string
          updated_at?: string
          visitor_email?: string | null
          visitor_name?: string | null
          visitor_phone?: string | null
          wait_until?: string | null
          widget_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_sessions_organization_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_evolution_instance_id_fkey"
            columns: ["evolution_instance_id"]
            isOneToOne: false
            referencedRelation: "evolution_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "twilio_phone_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_conversations: {
        Row: {
          created_at: string
          created_by: string | null
          ended_at: string | null
          id: string
          org_id: string
          started_at: string
          title: string
          updated_at: string
          visibility: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          id?: string
          org_id: string
          started_at?: string
          title?: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          id?: string
          org_id?: string
          started_at?: string
          title?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_conversations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_messages: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          metadata: Json
          parts: Json
          role: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          metadata?: Json
          parts?: Json
          role: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          parts?: Json
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "copilot_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_runs: {
        Row: {
          conversation_id: string
          created_at: string
          created_by: string | null
          ended_at: string | null
          error: string | null
          estimated_cost_usd: number
          id: string
          input_tokens: number
          model: string
          org_id: string
          output_tokens: number
          provider: string
          started_at: string
          status: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          error?: string | null
          estimated_cost_usd?: number
          id?: string
          input_tokens?: number
          model: string
          org_id: string
          output_tokens?: number
          provider: string
          started_at?: string
          status?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          error?: string | null
          estimated_cost_usd?: number
          id?: string
          input_tokens?: number
          model?: string
          org_id?: string
          output_tokens?: number
          provider?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "copilot_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_tool_calls: {
        Row: {
          created_at: string
          duration_ms: number
          error: string | null
          id: string
          input: Json
          output: Json
          run_id: string
          status: string
          tool_name: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number
          error?: string | null
          id?: string
          input?: Json
          output?: Json
          run_id: string
          status?: string
          tool_name: string
        }
        Update: {
          created_at?: string
          duration_ms?: number
          error?: string | null
          id?: string
          input?: Json
          output?: Json
          run_id?: string
          status?: string
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_tool_calls_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "copilot_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_field_definitions: {
        Row: {
          archived: boolean
          created_at: string
          created_by: string | null
          default_value: Json | null
          entity: Database["public"]["Enums"]["custom_field_entity"]
          filterable: boolean
          group_name: string | null
          help_text: string | null
          id: string
          key: string
          label: string
          options: Json | null
          org_id: string
          position: number
          required: boolean
          type: Database["public"]["Enums"]["custom_field_type"]
          unique_per_org: boolean
          updated_at: string
          validation: Json | null
          visible_in_list: boolean
        }
        Insert: {
          archived?: boolean
          created_at?: string
          created_by?: string | null
          default_value?: Json | null
          entity: Database["public"]["Enums"]["custom_field_entity"]
          filterable?: boolean
          group_name?: string | null
          help_text?: string | null
          id?: string
          key: string
          label: string
          options?: Json | null
          org_id: string
          position?: number
          required?: boolean
          type: Database["public"]["Enums"]["custom_field_type"]
          unique_per_org?: boolean
          updated_at?: string
          validation?: Json | null
          visible_in_list?: boolean
        }
        Update: {
          archived?: boolean
          created_at?: string
          created_by?: string | null
          default_value?: Json | null
          entity?: Database["public"]["Enums"]["custom_field_entity"]
          filterable?: boolean
          group_name?: string | null
          help_text?: string | null
          id?: string
          key?: string
          label?: string
          options?: Json | null
          org_id?: string
          position?: number
          required?: boolean
          type?: Database["public"]["Enums"]["custom_field_type"]
          unique_per_org?: boolean
          updated_at?: string
          validation?: Json | null
          visible_in_list?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "custom_field_definitions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          content: string
          created_at: string
          embedding: string | null
          id: number
          knowledge_source_id: string | null
          metadata: Json
        }
        Insert: {
          content: string
          created_at?: string
          embedding?: string | null
          id?: number
          knowledge_source_id?: string | null
          metadata?: Json
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string | null
          id?: number
          knowledge_source_id?: string | null
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "documents_knowledge_source_id_fkey"
            columns: ["knowledge_source_id"]
            isOneToOne: false
            referencedRelation: "knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sections: {
        Row: {
          created_at: string
          html_content: string
          id: string
          is_global: boolean
          name: string
          org_id: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          html_content?: string
          id?: string
          is_global?: boolean
          name: string
          org_id: string
          type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          html_content?: string
          id?: string
          is_global?: boolean
          name?: string
          org_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_template_sections: {
        Row: {
          created_at: string
          html_content: string
          id: string
          name: string
          section_id: string | null
          sort_order: number
          template_id: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          html_content?: string
          id?: string
          name: string
          section_id?: string | null
          sort_order?: number
          template_id: string
          type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          html_content?: string
          id?: string
          name?: string
          section_id?: string | null
          sort_order?: number
          template_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_template_sections_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "email_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_template_sections_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          ai_prompt: string | null
          created_at: string
          created_by: string | null
          description: string | null
          document: Json
          html_snapshot: string | null
          id: string
          name: string
          org_id: string
          plain_text_snapshot: string | null
          preview_text: string
          status: string
          subject_line: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          ai_prompt?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          document?: Json
          html_snapshot?: string | null
          id?: string
          name: string
          org_id: string
          plain_text_snapshot?: string | null
          preview_text?: string
          status?: string
          subject_line?: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          ai_prompt?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          document?: Json
          html_snapshot?: string | null
          id?: string
          name?: string
          org_id?: string
          plain_text_snapshot?: string | null
          preview_text?: string
          status?: string
          subject_line?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_unsubscribes: {
        Row: {
          contact_id: string | null
          email: string
          id: string
          org_id: string
          source: string
          unsubscribed_at: string
        }
        Insert: {
          contact_id?: string | null
          email: string
          id?: string
          org_id: string
          source?: string
          unsubscribed_at?: string
        }
        Update: {
          contact_id?: string | null
          email?: string
          id?: string
          org_id?: string
          source?: string
          unsubscribed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_unsubscribes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_unsubscribes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      event_dispatches: {
        Row: {
          depth: number
          dispatched_at: string
          event_type: string
          id: string
          org_id: string
          parent_id: string | null
          payload: Json
          source_id: string
          source_table: string
          workflow_ids: string[]
        }
        Insert: {
          depth?: number
          dispatched_at?: string
          event_type: string
          id?: string
          org_id: string
          parent_id?: string | null
          payload?: Json
          source_id: string
          source_table: string
          workflow_ids?: string[]
        }
        Update: {
          depth?: number
          dispatched_at?: string
          event_type?: string
          id?: string
          org_id?: string
          parent_id?: string | null
          payload?: Json
          source_id?: string
          source_table?: string
          workflow_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "event_dispatches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_dispatches_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "event_dispatches"
            referencedColumns: ["id"]
          },
        ]
      }
      event_logs: {
        Row: {
          actor_id: string | null
          actor_type: string | null
          correlation_id: string | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          error_stack: string | null
          event_type: string
          id: string
          org_id: string | null
          payload: Json
          severity: string
          source: string
          status: string
        }
        Insert: {
          actor_id?: string | null
          actor_type?: string | null
          correlation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          error_stack?: string | null
          event_type: string
          id?: string
          org_id?: string | null
          payload?: Json
          severity?: string
          source: string
          status?: string
        }
        Update: {
          actor_id?: string | null
          actor_type?: string | null
          correlation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          error_stack?: string | null
          event_type?: string
          id?: string
          org_id?: string | null
          payload?: Json
          severity?: string
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      event_types: {
        Row: {
          active: boolean
          allowed_location_kinds: string[]
          color: string
          created_at: string
          default_store_location_id: string | null
          description: string | null
          duration_minutes: number
          id: string
          location_type: string
          location_value: string | null
          org_id: string
          slug: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          allowed_location_kinds?: string[]
          color?: string
          created_at?: string
          default_store_location_id?: string | null
          description?: string | null
          duration_minutes?: number
          id?: string
          location_type?: string
          location_value?: string | null
          org_id: string
          slug: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          allowed_location_kinds?: string[]
          color?: string
          created_at?: string
          default_store_location_id?: string | null
          description?: string | null
          duration_minutes?: number
          id?: string
          location_type?: string
          location_value?: string | null
          org_id?: string
          slug?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_types_default_store_location_id_fkey"
            columns: ["default_store_location_id"]
            isOneToOne: false
            referencedRelation: "tenant_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_types_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      evolution_instances: {
        Row: {
          base_url: string
          connected_at: string | null
          created_at: string
          created_by: string | null
          id: string
          instance_name: string
          is_active: boolean
          last_error: string | null
          org_id: string
          phone_number: string | null
          status: string
          token_encrypted: string
          updated_at: string
          webhook_secret_encrypted: string | null
        }
        Insert: {
          base_url: string
          connected_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          instance_name: string
          is_active?: boolean
          last_error?: string | null
          org_id: string
          phone_number?: string | null
          status?: string
          token_encrypted: string
          updated_at?: string
          webhook_secret_encrypted?: string | null
        }
        Update: {
          base_url?: string
          connected_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          instance_name?: string
          is_active?: boolean
          last_error?: string | null
          org_id?: string
          phone_number?: string | null
          status?: string
          token_encrypted?: string
          updated_at?: string
          webhook_secret_encrypted?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evolution_instances_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_channels: {
        Row: {
          agent_id: string | null
          automation_id: string | null
          created_at: string
          display_name: string | null
          encrypted_api_key: string
          id: string
          is_active: boolean
          location_id: string
          org_id: string
          updated_at: string
          webhook_secret: string
        }
        Insert: {
          agent_id?: string | null
          automation_id?: string | null
          created_at?: string
          display_name?: string | null
          encrypted_api_key: string
          id?: string
          is_active?: boolean
          location_id: string
          org_id: string
          updated_at?: string
          webhook_secret: string
        }
        Update: {
          agent_id?: string | null
          automation_id?: string | null
          created_at?: string
          display_name?: string | null
          encrypted_api_key?: string
          id?: string
          is_active?: boolean
          location_id?: string
          org_id?: string
          updated_at?: string
          webhook_secret?: string
        }
        Relationships: [
          {
            foreignKeyName: "ghl_channels_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ghl_channels_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "_legacy_tool_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ghl_channels_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_events: {
        Row: {
          body: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          direction: string | null
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          location_id: string
          message_type: string | null
          org_id: string
          phone: string | null
          raw_payload: Json
        }
        Insert: {
          body?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          direction?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          location_id: string
          message_type?: string | null
          org_id: string
          phone?: string | null
          raw_payload?: Json
        }
        Update: {
          body?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          direction?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          location_id?: string
          message_type?: string | null
          org_id?: string
          phone?: string | null
          raw_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ghl_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ghl_reengagement_sent: {
        Row: {
          ghl_contact_id: string
          id: string
          location_id: string
          org_id: string
          sent_at: string
        }
        Insert: {
          ghl_contact_id: string
          id?: string
          location_id: string
          org_id: string
          sent_at?: string
        }
        Update: {
          ghl_contact_id?: string
          id?: string
          location_id?: string
          org_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ghl_reengagement_sent_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      google_business_profiles: {
        Row: {
          address: string | null
          average_rating: number | null
          business_name: string | null
          created_at: string
          id: string
          is_active: boolean
          last_scrape_error: string | null
          last_scrape_status: string | null
          last_scraped_at: string | null
          org_id: string
          place_id: string
          scrape_interval_hours: number
          serpapi_key_encrypted: string
          total_reviews_count: number | null
          updated_at: string
          widget_token: string
        }
        Insert: {
          address?: string | null
          average_rating?: number | null
          business_name?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_scrape_error?: string | null
          last_scrape_status?: string | null
          last_scraped_at?: string | null
          org_id: string
          place_id: string
          scrape_interval_hours?: number
          serpapi_key_encrypted: string
          total_reviews_count?: number | null
          updated_at?: string
          widget_token?: string
        }
        Update: {
          address?: string | null
          average_rating?: number | null
          business_name?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_scrape_error?: string | null
          last_scrape_status?: string | null
          last_scraped_at?: string | null
          org_id?: string
          place_id?: string
          scrape_interval_hours?: number
          serpapi_key_encrypted?: string
          total_reviews_count?: number | null
          updated_at?: string
          widget_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_business_profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      google_review_photos: {
        Row: {
          created_at: string
          height: number | null
          hetzner_url: string | null
          id: string
          org_id: string
          original_url: string
          position: number
          review_id: string
          width: number | null
        }
        Insert: {
          created_at?: string
          height?: number | null
          hetzner_url?: string | null
          id?: string
          org_id: string
          original_url: string
          position?: number
          review_id: string
          width?: number | null
        }
        Update: {
          created_at?: string
          height?: number | null
          hetzner_url?: string | null
          id?: string
          org_id?: string
          original_url?: string
          position?: number
          review_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "google_review_photos_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_review_photos_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "google_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      google_reviews: {
        Row: {
          created_at: string
          date_iso: string | null
          date_text: string | null
          first_seen_at: string
          helpful_count: number
          id: string
          is_local_guide: boolean
          is_removed: boolean
          last_seen_at: string
          local_guide_reviews_count: number | null
          org_id: string
          owner_response: string | null
          owner_response_date: string | null
          profile_id: string
          rating: number
          review_id: string
          reviewer_name: string | null
          reviewer_photo_url: string | null
          reviewer_profile_url: string | null
          text: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_iso?: string | null
          date_text?: string | null
          first_seen_at?: string
          helpful_count?: number
          id?: string
          is_local_guide?: boolean
          is_removed?: boolean
          last_seen_at?: string
          local_guide_reviews_count?: number | null
          org_id: string
          owner_response?: string | null
          owner_response_date?: string | null
          profile_id: string
          rating: number
          review_id: string
          reviewer_name?: string | null
          reviewer_photo_url?: string | null
          reviewer_profile_url?: string | null
          text?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_iso?: string | null
          date_text?: string | null
          first_seen_at?: string
          helpful_count?: number
          id?: string
          is_local_guide?: boolean
          is_removed?: boolean
          last_seen_at?: string
          local_guide_reviews_count?: number | null
          org_id?: string
          owner_response?: string | null
          owner_response_date?: string | null
          profile_id?: string
          rating?: number
          review_id?: string
          reviewer_name?: string | null
          reviewer_photo_url?: string | null
          reviewer_profile_url?: string | null
          text?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_reviews_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_reviews_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "google_business_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_email_routes: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          org_id: string
          route_address: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          org_id: string
          route_address: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          org_id?: string
          route_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_email_routes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_health_checks: {
        Row: {
          checked_at: string
          error: string | null
          id: string
          integration_id: string
          latency_ms: number | null
          organization_id: string
          status: string
        }
        Insert: {
          checked_at?: string
          error?: string | null
          id?: string
          integration_id: string
          latency_ms?: number | null
          organization_id: string
          status: string
        }
        Update: {
          checked_at?: string
          error?: string | null
          id?: string
          integration_id?: string
          latency_ms?: number | null
          organization_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_health_checks_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_health_checks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          config: Json
          created_at: string
          encrypted_api_key: string
          failure_count: number
          health_status: string
          id: string
          is_active: boolean
          key_hint: string | null
          last_checked_at: string | null
          last_error: string | null
          location_id: string | null
          manychat_channel_id: string | null
          name: string
          organization_id: string
          provider: Database["public"]["Enums"]["integration_provider"]
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          encrypted_api_key: string
          failure_count?: number
          health_status?: string
          id?: string
          is_active?: boolean
          key_hint?: string | null
          last_checked_at?: string | null
          last_error?: string | null
          location_id?: string | null
          manychat_channel_id?: string | null
          name: string
          organization_id: string
          provider: Database["public"]["Enums"]["integration_provider"]
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          encrypted_api_key?: string
          failure_count?: number
          health_status?: string
          id?: string
          is_active?: boolean
          key_hint?: string | null
          last_checked_at?: string | null
          last_error?: string | null
          location_id?: string | null
          manychat_channel_id?: string | null
          name?: string
          organization_id?: string
          provider?: Database["public"]["Enums"]["integration_provider"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_manychat_channel_id_fkey"
            columns: ["manychat_channel_id"]
            isOneToOne: false
            referencedRelation: "manychat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_sources: {
        Row: {
          chunk_count: number
          created_at: string
          error_detail: string | null
          id: string
          name: string
          organization_id: string
          source_type: string
          source_url: string | null
          status: string
          updated_at: string
        }
        Insert: {
          chunk_count?: number
          created_at?: string
          error_detail?: string | null
          id?: string
          name: string
          organization_id: string
          source_type: string
          source_url?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          chunk_count?: number
          created_at?: string
          error_detail?: string | null
          id?: string
          name?: string
          organization_id?: string
          source_type?: string
          source_url?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      landing_config: {
        Row: {
          cta_image_url: string | null
          id: string
          scroll_images: string[]
          updated_at: string
        }
        Insert: {
          cta_image_url?: string | null
          id?: string
          scroll_images?: string[]
          updated_at?: string
        }
        Update: {
          cta_image_url?: string | null
          id?: string
          scroll_images?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      manychat_channels: {
        Row: {
          channel_name: string
          config: Json
          created_at: string
          encrypted_api_key: string
          id: string
          is_active: boolean
          key_hint: string | null
          org_id: string
          updated_at: string
          webhook_secret: string
        }
        Insert: {
          channel_name: string
          config?: Json
          created_at?: string
          encrypted_api_key: string
          id?: string
          is_active?: boolean
          key_hint?: string | null
          org_id: string
          updated_at?: string
          webhook_secret: string
        }
        Update: {
          channel_name?: string
          config?: Json
          created_at?: string
          encrypted_api_key?: string
          id?: string
          is_active?: boolean
          key_hint?: string | null
          org_id?: string
          updated_at?: string
          webhook_secret?: string
        }
        Relationships: [
          {
            foreignKeyName: "manychat_channels_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      manychat_events: {
        Row: {
          action_log_id: string | null
          channel_id: string
          created_at: string
          event_payload: Json
          event_type: string
          id: string
          matched_rule_id: string | null
          org_id: string
          status: string
        }
        Insert: {
          action_log_id?: string | null
          channel_id: string
          created_at?: string
          event_payload?: Json
          event_type: string
          id?: string
          matched_rule_id?: string | null
          org_id: string
          status: string
        }
        Update: {
          action_log_id?: string | null
          channel_id?: string
          created_at?: string
          event_payload?: Json
          event_type?: string
          id?: string
          matched_rule_id?: string | null
          org_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "manychat_events_action_log_id_fkey"
            columns: ["action_log_id"]
            isOneToOne: false
            referencedRelation: "action_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manychat_events_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "manychat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manychat_events_matched_rule_id_fkey"
            columns: ["matched_rule_id"]
            isOneToOne: false
            referencedRelation: "manychat_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manychat_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      manychat_rules: {
        Row: {
          agent_id: string | null
          channel_id: string
          condition: Json
          created_at: string
          event_type: string
          id: string
          is_active: boolean
          org_id: string
          priority: number
          tool_config_id: string
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          channel_id: string
          condition?: Json
          created_at?: string
          event_type: string
          id?: string
          is_active?: boolean
          org_id: string
          priority?: number
          tool_config_id: string
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          channel_id?: string
          condition?: Json
          created_at?: string
          event_type?: string
          id?: string
          is_active?: boolean
          org_id?: string
          priority?: number
          tool_config_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manychat_rules_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manychat_rules_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "manychat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manychat_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manychat_rules_tool_config_id_fkey"
            columns: ["tool_config_id"]
            isOneToOne: false
            referencedRelation: "_legacy_tool_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_oauth_clients: {
        Row: {
          client_id: string
          client_secret_hash: string | null
          created_at: string
          created_by_user_id: string | null
          created_via: string
          id: string
          last_used_at: string | null
          name: string
          redirect_uris: string[]
          scope: string
        }
        Insert: {
          client_id: string
          client_secret_hash?: string | null
          created_at?: string
          created_by_user_id?: string | null
          created_via?: string
          id?: string
          last_used_at?: string | null
          name: string
          redirect_uris?: string[]
          scope?: string
        }
        Update: {
          client_id?: string
          client_secret_hash?: string | null
          created_at?: string
          created_by_user_id?: string | null
          created_via?: string
          id?: string
          last_used_at?: string | null
          name?: string
          redirect_uris?: string[]
          scope?: string
        }
        Relationships: []
      }
      mcp_oauth_codes: {
        Row: {
          client_id: string
          code_challenge: string
          code_challenge_method: string
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          org_id: string
          redirect_uri: string
          scope: string
          used: boolean
          user_id: string
        }
        Insert: {
          client_id: string
          code_challenge: string
          code_challenge_method?: string
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          org_id: string
          redirect_uri: string
          scope?: string
          used?: boolean
          user_id: string
        }
        Update: {
          client_id?: string
          code_challenge?: string
          code_challenge_method?: string
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          org_id?: string
          redirect_uri?: string
          scope?: string
          used?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_oauth_codes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "mcp_oauth_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "mcp_oauth_codes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_oauth_tokens: {
        Row: {
          access_token_hash: string
          client_id: string
          created_at: string
          expires_at: string
          id: string
          last_used_at: string | null
          org_id: string
          refresh_expires_at: string | null
          refresh_token_hash: string | null
          revoked: boolean
          scope: string
          user_id: string
        }
        Insert: {
          access_token_hash: string
          client_id: string
          created_at?: string
          expires_at: string
          id?: string
          last_used_at?: string | null
          org_id: string
          refresh_expires_at?: string | null
          refresh_token_hash?: string | null
          revoked?: boolean
          scope?: string
          user_id: string
        }
        Update: {
          access_token_hash?: string
          client_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          last_used_at?: string | null
          org_id?: string
          refresh_expires_at?: string | null
          refresh_token_hash?: string | null
          revoked?: boolean
          scope?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_oauth_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "mcp_oauth_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "mcp_oauth_tokens_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_channels: {
        Row: {
          agent_id: string | null
          automation_id: string | null
          channel_type: string
          config: Json
          connection_error: string | null
          created_at: string
          encrypted_page_access_token: string
          id: string
          ig_account_id: string | null
          ig_username: string | null
          is_active: boolean
          last_synced_at: string | null
          org_id: string
          page_id: string
          page_name: string | null
          provider: string
          token_expires_at: string | null
          updated_at: string
          webhook_verified: boolean
        }
        Insert: {
          agent_id?: string | null
          automation_id?: string | null
          channel_type: string
          config?: Json
          connection_error?: string | null
          created_at?: string
          encrypted_page_access_token: string
          id?: string
          ig_account_id?: string | null
          ig_username?: string | null
          is_active?: boolean
          last_synced_at?: string | null
          org_id: string
          page_id: string
          page_name?: string | null
          provider?: string
          token_expires_at?: string | null
          updated_at?: string
          webhook_verified?: boolean
        }
        Update: {
          agent_id?: string | null
          automation_id?: string | null
          channel_type?: string
          config?: Json
          connection_error?: string | null
          created_at?: string
          encrypted_page_access_token?: string
          id?: string
          ig_account_id?: string | null
          ig_username?: string | null
          is_active?: boolean
          last_synced_at?: string | null
          org_id?: string
          page_id?: string
          page_name?: string | null
          provider?: string
          token_expires_at?: string | null
          updated_at?: string
          webhook_verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "meta_channels_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_channels_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "_legacy_tool_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_channels_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["crm_entity_type"] | null
          id: string
          org_id: string
          pinned: boolean
          title: string | null
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["crm_entity_type"] | null
          id?: string
          org_id: string
          pinned?: boolean
          title?: string | null
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["crm_entity_type"] | null
          id?: string
          org_id?: string
          pinned?: boolean
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          org_id: string
          payload: Json
          read_at: string | null
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          payload?: Json
          read_at?: string | null
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          payload?: Json
          read_at?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          account_id: string | null
          assigned_to: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          custom_fields: Json
          expected_close_date: string | null
          id: string
          org_id: string
          pipeline_id: string
          position: number
          stage_id: string
          status: string
          title: string
          updated_at: string
          value: number
        }
        Insert: {
          account_id?: string | null
          assigned_to?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          custom_fields?: Json
          expected_close_date?: string | null
          id?: string
          org_id: string
          pipeline_id: string
          position?: number
          stage_id: string
          status?: string
          title: string
          updated_at?: string
          value?: number
        }
        Update: {
          account_id?: string | null
          assigned_to?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          custom_fields?: Json
          expected_close_date?: string | null
          id?: string
          org_id?: string
          pipeline_id?: string
          position?: number
          stage_id?: string
          status?: string
          title?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_activities: {
        Row: {
          call_log_id: string | null
          content: string | null
          conversation_id: string | null
          created_at: string
          created_by: string | null
          id: string
          metadata: Json | null
          opportunity_id: string
          org_id: string
          type: string
        }
        Insert: {
          call_log_id?: string | null
          content?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json | null
          opportunity_id: string
          org_id: string
          type: string
        }
        Update: {
          call_log_id?: string | null
          content?: string | null
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json | null
          opportunity_id?: string
          org_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_activities_call_log_id_fkey"
            columns: ["call_log_id"]
            isOneToOne: false
            referencedRelation: "call_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_activities_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_activities_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_activities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_contacts: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          is_primary: boolean
          opportunity_id: string
          org_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          opportunity_id: string
          org_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          opportunity_id?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_contacts_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
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
        Update: {
          opportunity_id?: string
          tag_id?: string
          tagged_at?: string
          tagged_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_tags_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      org_invites: {
        Row: {
          accepted_at: string | null
          email: string
          expires_at: string | null
          id: string
          invited_at: string
          invited_by: string | null
          org_id: string
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          accepted_at?: string | null
          email: string
          expires_at?: string | null
          id?: string
          invited_at?: string
          invited_by?: string | null
          org_id: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          accepted_at?: string | null
          email?: string
          expires_at?: string | null
          id?: string
          invited_at?: string
          invited_by?: string | null
          org_id?: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: [
          {
            foreignKeyName: "org_invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_template_installs: {
        Row: {
          asset_groups: string[]
          id: string
          installed_at: string
          installed_by: string | null
          owner_org_id: string
          summary: Json
          target_org_id: string | null
          target_org_name: string | null
          template_id: string | null
          template_name: string | null
        }
        Insert: {
          asset_groups?: string[]
          id?: string
          installed_at?: string
          installed_by?: string | null
          owner_org_id: string
          summary?: Json
          target_org_id?: string | null
          target_org_name?: string | null
          template_id?: string | null
          template_name?: string | null
        }
        Update: {
          asset_groups?: string[]
          id?: string
          installed_at?: string
          installed_by?: string | null
          owner_org_id?: string
          summary?: Json
          target_org_id?: string | null
          target_org_name?: string | null
          template_id?: string | null
          template_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_template_installs_owner_org_id_fkey"
            columns: ["owner_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_template_installs_target_org_id_fkey"
            columns: ["target_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_template_installs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "org_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      org_templates: {
        Row: {
          asset_groups: string[]
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          industry: string | null
          name: string
          owner_org_id: string
          snapshot: Json
          snapshot_at: string | null
          source_org_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          asset_groups?: string[]
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          industry?: string | null
          name: string
          owner_org_id: string
          snapshot?: Json
          snapshot_at?: string | null
          source_org_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          asset_groups?: string[]
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          industry?: string | null
          name?: string
          owner_org_id?: string
          snapshot?: Json
          snapshot_at?: string | null
          source_org_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_templates_owner_org_id_fkey"
            columns: ["owner_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_templates_source_org_id_fkey"
            columns: ["source_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          accent_color: string | null
          address_city: string | null
          address_country: string | null
          address_line1: string | null
          address_line2: string | null
          address_postal_code: string | null
          address_state: string | null
          brand_name: string | null
          created_at: string
          daily_cost_cap_usd_override: number | null
          default_currency: string
          delegation_visibility: string
          id: string
          is_active: boolean
          legal_name: string | null
          logo_url: string | null
          name: string
          settings: Json
          slug: string
          tax_id: string | null
          timezone: string
          updated_at: string
          widget_avatar_url: string | null
          widget_display_name: string | null
          widget_primary_color: string | null
          widget_token: string
          widget_welcome_message: string | null
        }
        Insert: {
          accent_color?: string | null
          address_city?: string | null
          address_country?: string | null
          address_line1?: string | null
          address_line2?: string | null
          address_postal_code?: string | null
          address_state?: string | null
          brand_name?: string | null
          created_at?: string
          daily_cost_cap_usd_override?: number | null
          default_currency?: string
          delegation_visibility?: string
          id?: string
          is_active?: boolean
          legal_name?: string | null
          logo_url?: string | null
          name: string
          settings?: Json
          slug: string
          tax_id?: string | null
          timezone?: string
          updated_at?: string
          widget_avatar_url?: string | null
          widget_display_name?: string | null
          widget_primary_color?: string | null
          widget_token: string
          widget_welcome_message?: string | null
        }
        Update: {
          accent_color?: string | null
          address_city?: string | null
          address_country?: string | null
          address_line1?: string | null
          address_line2?: string | null
          address_postal_code?: string | null
          address_state?: string | null
          brand_name?: string | null
          created_at?: string
          daily_cost_cap_usd_override?: number | null
          default_currency?: string
          delegation_visibility?: string
          id?: string
          is_active?: boolean
          legal_name?: string | null
          logo_url?: string | null
          name?: string
          settings?: Json
          slug?: string
          tax_id?: string | null
          timezone?: string
          updated_at?: string
          widget_avatar_url?: string | null
          widget_display_name?: string | null
          widget_primary_color?: string | null
          widget_token?: string
          widget_welcome_message?: string | null
        }
        Relationships: []
      }
      pipeline_stages: {
        Row: {
          color: string
          created_at: string
          id: string
          is_lost: boolean
          is_won: boolean
          name: string
          org_id: string
          pipeline_id: string
          position: number
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_lost?: boolean
          is_won?: boolean
          name: string
          org_id: string
          pipeline_id: string
          position: number
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_lost?: boolean
          is_won?: boolean
          name?: string
          org_id?: string
          pipeline_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      pipelines: {
        Row: {
          card_fields: Json
          created_at: string
          id: string
          is_default: boolean
          name: string
          org_id: string
          position: number
          updated_at: string
        }
        Insert: {
          card_fields?: Json
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          org_id: string
          position?: number
          updated_at?: string
        }
        Update: {
          card_fields?: Json
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          org_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipelines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_email_settings: {
        Row: {
          api_key_encrypted: string | null
          created_at: string
          default_from_email: string | null
          default_from_name: string | null
          default_reply_to: string | null
          id: string
          is_active: boolean
          last_tested_at: string | null
          provider: string
          updated_at: string
        }
        Insert: {
          api_key_encrypted?: string | null
          created_at?: string
          default_from_email?: string | null
          default_from_name?: string | null
          default_reply_to?: string | null
          id?: string
          is_active?: boolean
          last_tested_at?: string | null
          provider?: string
          updated_at?: string
        }
        Update: {
          api_key_encrypted?: string | null
          created_at?: string
          default_from_email?: string | null
          default_from_name?: string | null
          default_reply_to?: string | null
          id?: string
          is_active?: boolean
          last_tested_at?: string | null
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          encrypted_value: string
          hint: string | null
          key: string
          updated_at: string
        }
        Insert: {
          encrypted_value: string
          hint?: string | null
          key: string
          updated_at?: string
        }
        Update: {
          encrypted_value?: string
          hint?: string | null
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_execution_runs: {
        Row: {
          created_at: string
          duration_minutes: number | null
          end_time: string | null
          environment: Database["public"]["Enums"]["project_run_environment"]
          executor_name: string | null
          executor_type: Database["public"]["Enums"]["project_executor_type"]
          id: string
          needs_validation: boolean
          notes: string | null
          org_id: string
          result: string | null
          start_time: string | null
          status: Database["public"]["Enums"]["project_run_status"]
          task_id: string
        }
        Insert: {
          created_at?: string
          duration_minutes?: number | null
          end_time?: string | null
          environment?: Database["public"]["Enums"]["project_run_environment"]
          executor_name?: string | null
          executor_type?: Database["public"]["Enums"]["project_executor_type"]
          id?: string
          needs_validation?: boolean
          notes?: string | null
          org_id: string
          result?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["project_run_status"]
          task_id: string
        }
        Update: {
          created_at?: string
          duration_minutes?: number | null
          end_time?: string | null
          environment?: Database["public"]["Enums"]["project_run_environment"]
          executor_name?: string | null
          executor_type?: Database["public"]["Enums"]["project_executor_type"]
          id?: string
          needs_validation?: boolean
          notes?: string | null
          org_id?: string
          result?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["project_run_status"]
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_execution_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_execution_runs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      project_folders: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          icon: string | null
          id: string
          name: string
          org_id: string
          parent_id: string | null
          position: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          icon?: string | null
          id?: string
          name: string
          org_id: string
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          icon?: string | null
          id?: string
          name?: string
          org_id?: string
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_folders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "project_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      project_labels: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          org_id: string
          project_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          org_id: string
          project_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_labels_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_labels_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_mcp_audit_logs: {
        Row: {
          action: string
          actor: string | null
          actor_type: Database["public"]["Enums"]["project_actor_type"]
          area: Database["public"]["Enums"]["project_mcp_area"]
          id: string
          notes: string | null
          org_id: string
          status: Database["public"]["Enums"]["project_audit_status"]
          target: string | null
          timestamp: string
        }
        Insert: {
          action: string
          actor?: string | null
          actor_type?: Database["public"]["Enums"]["project_actor_type"]
          area?: Database["public"]["Enums"]["project_mcp_area"]
          id?: string
          notes?: string | null
          org_id: string
          status?: Database["public"]["Enums"]["project_audit_status"]
          target?: string | null
          timestamp?: string
        }
        Update: {
          action?: string
          actor?: string | null
          actor_type?: Database["public"]["Enums"]["project_actor_type"]
          area?: Database["public"]["Enums"]["project_mcp_area"]
          id?: string
          notes?: string | null
          org_id?: string
          status?: Database["public"]["Enums"]["project_audit_status"]
          target?: string | null
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_mcp_audit_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      project_mcp_tokens: {
        Row: {
          active: boolean
          created_at: string
          id: string
          org_id: string
          rotated_at: string | null
          token_encrypted: string | null
          token_hash: string
          token_prefix: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          org_id: string
          rotated_at?: string | null
          token_encrypted?: string | null
          token_hash: string
          token_prefix: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          org_id?: string
          rotated_at?: string | null
          token_encrypted?: string | null
          token_hash?: string
          token_prefix?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_mcp_tokens_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      project_saved_views: {
        Row: {
          created_at: string
          filters: Json
          id: string
          is_default: boolean
          name: string
          org_id: string
          owner_id: string | null
          project_id: string
          scope: Database["public"]["Enums"]["project_view_scope"]
          sorting: Json
          updated_at: string
          view_type: Database["public"]["Enums"]["project_view_type"]
        }
        Insert: {
          created_at?: string
          filters?: Json
          id?: string
          is_default?: boolean
          name: string
          org_id: string
          owner_id?: string | null
          project_id: string
          scope?: Database["public"]["Enums"]["project_view_scope"]
          sorting?: Json
          updated_at?: string
          view_type?: Database["public"]["Enums"]["project_view_type"]
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          is_default?: boolean
          name?: string
          org_id?: string
          owner_id?: string | null
          project_id?: string
          scope?: Database["public"]["Enums"]["project_view_scope"]
          sorting?: Json
          updated_at?: string
          view_type?: Database["public"]["Enums"]["project_view_type"]
        }
        Relationships: [
          {
            foreignKeyName: "project_saved_views_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_saved_views_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_task_comments: {
        Row: {
          author: string
          author_type: Database["public"]["Enums"]["project_actor_type"]
          content: string
          created_at: string
          id: string
          org_id: string
          task_id: string
        }
        Insert: {
          author: string
          author_type?: Database["public"]["Enums"]["project_actor_type"]
          content: string
          created_at?: string
          id?: string
          org_id: string
          task_id: string
        }
        Update: {
          author?: string
          author_type?: Database["public"]["Enums"]["project_actor_type"]
          content?: string
          created_at?: string
          id?: string
          org_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_task_comments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      project_task_dependencies: {
        Row: {
          dependency_rule: Database["public"]["Enums"]["project_dependency_rule"]
          depends_on_id: string
          task_id: string
        }
        Insert: {
          dependency_rule?: Database["public"]["Enums"]["project_dependency_rule"]
          depends_on_id: string
          task_id: string
        }
        Update: {
          dependency_rule?: Database["public"]["Enums"]["project_dependency_rule"]
          depends_on_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_task_dependencies_depends_on_id_fkey"
            columns: ["depends_on_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      project_task_labels: {
        Row: {
          label_id: string
          task_id: string
        }
        Insert: {
          label_id: string
          task_id: string
        }
        Update: {
          label_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_task_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "project_labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_task_labels_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      project_tasks: {
        Row: {
          ai_context: string | null
          ai_view_enabled: boolean
          assignee_id: string | null
          completed: boolean
          completed_at: string | null
          created_at: string
          created_by: string | null
          deliverable: string | null
          description: string | null
          end_date: string | null
          execution_status: Database["public"]["Enums"]["project_execution_status"]
          expected_deliverable: string | null
          id: string
          last_agent_update: string | null
          last_human_review: string | null
          name: string
          needs_validation: boolean
          org_id: string
          parent_task_id: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          project_id: string
          responsible_id: string | null
          start_date: string | null
          step: Database["public"]["Enums"]["project_task_step"]
          updated_at: string
          validation_criteria: string | null
          validation_status: Database["public"]["Enums"]["project_validation_status"]
        }
        Insert: {
          ai_context?: string | null
          ai_view_enabled?: boolean
          assignee_id?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deliverable?: string | null
          description?: string | null
          end_date?: string | null
          execution_status?: Database["public"]["Enums"]["project_execution_status"]
          expected_deliverable?: string | null
          id?: string
          last_agent_update?: string | null
          last_human_review?: string | null
          name: string
          needs_validation?: boolean
          org_id: string
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id: string
          responsible_id?: string | null
          start_date?: string | null
          step?: Database["public"]["Enums"]["project_task_step"]
          updated_at?: string
          validation_criteria?: string | null
          validation_status?: Database["public"]["Enums"]["project_validation_status"]
        }
        Update: {
          ai_context?: string | null
          ai_view_enabled?: boolean
          assignee_id?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deliverable?: string | null
          description?: string | null
          end_date?: string | null
          execution_status?: Database["public"]["Enums"]["project_execution_status"]
          expected_deliverable?: string | null
          id?: string
          last_agent_update?: string | null
          last_human_review?: string | null
          name?: string
          needs_validation?: boolean
          org_id?: string
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string
          responsible_id?: string | null
          start_date?: string | null
          step?: Database["public"]["Enums"]["project_task_step"]
          updated_at?: string
          validation_criteria?: string | null
          validation_status?: Database["public"]["Enums"]["project_validation_status"]
        }
        Relationships: [
          {
            foreignKeyName: "project_tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_at: string | null
          color: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          folder_id: string | null
          id: string
          name: string
          org_id: string
          position: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          folder_id?: string | null
          id?: string
          name: string
          org_id: string
          position?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          folder_id?: string | null
          id?: string
          name?: string
          org_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "project_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          org_id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          org_id: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          org_id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reusable_email_blocks: {
        Row: {
          block_type: string
          created_at: string
          document: Json
          id: string
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          block_type: string
          created_at?: string
          document?: Json
          id?: string
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          block_type?: string
          created_at?: string
          document?: Json
          id?: string
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reusable_email_blocks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_opportunity_ticks: {
        Row: {
          created_at: string
          event_type: string
          fire_at: string
          fired: boolean
          fired_at: string | null
          id: string
          opportunity_id: string
          org_id: string
          workflow_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          fire_at: string
          fired?: boolean
          fired_at?: string | null
          id?: string
          opportunity_id: string
          org_id: string
          workflow_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          fire_at?: string
          fired?: boolean
          fired_at?: string | null
          id?: string
          opportunity_id?: string
          org_id?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_opportunity_ticks_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_opportunity_ticks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_opportunity_ticks_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_workflow_ticks: {
        Row: {
          booking_id: string
          dispatched_at: string
          event_type: string
          fired_minute: string
          workflow_id: string
        }
        Insert: {
          booking_id: string
          dispatched_at?: string
          event_type: string
          fired_minute: string
          workflow_id: string
        }
        Update: {
          booking_id?: string
          dispatched_at?: string
          event_type?: string
          fired_minute?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_workflow_ticks_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_workflow_ticks_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduling_profiles: {
        Row: {
          created_at: string
          org_id: string
          slug: string
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          slug: string
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          slug?: string
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduling_profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      seo_config: {
        Row: {
          description: string
          favicon_url: string | null
          id: string
          keywords: string[]
          og_image_url: string | null
          site_title: string
          title_template: string
          updated_at: string
        }
        Insert: {
          description?: string
          favicon_url?: string | null
          id?: string
          keywords?: string[]
          og_image_url?: string | null
          site_title?: string
          title_template?: string
          updated_at?: string
        }
        Update: {
          description?: string
          favicon_url?: string | null
          id?: string
          keywords?: string[]
          og_image_url?: string | null
          site_title?: string
          title_template?: string
          updated_at?: string
        }
        Relationships: []
      }
      tags: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          org_id: string
          slug: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          org_id: string
          slug: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          org_id?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["crm_entity_type"] | null
          id: string
          org_id: string
          priority: Database["public"]["Enums"]["task_priority"]
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["crm_entity_type"] | null
          id?: string
          org_id: string
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["crm_entity_type"] | null
          id?: string
          org_id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_bots: {
        Row: {
          agent_id: string | null
          automation_enabled: boolean
          bot_name: string | null
          bot_token_encrypted: string
          bot_username: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          last_error: string | null
          notification_chat_ids: string[]
          org_id: string
          updated_at: string
          webhook_set: boolean
        }
        Insert: {
          agent_id?: string | null
          automation_enabled?: boolean
          bot_name?: string | null
          bot_token_encrypted: string
          bot_username?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          last_error?: string | null
          notification_chat_ids?: string[]
          org_id: string
          updated_at?: string
          webhook_set?: boolean
        }
        Update: {
          agent_id?: string | null
          automation_enabled?: boolean
          bot_name?: string | null
          bot_token_encrypted?: string
          bot_username?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          last_error?: string | null
          notification_chat_ids?: string[]
          org_id?: string
          updated_at?: string
          webhook_set?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "telegram_bots_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_bots_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_email_integrations: {
        Row: {
          api_key_encrypted: string | null
          created_at: string
          default_from_email: string | null
          default_from_name: string | null
          default_reply_to: string | null
          id: string
          key_hint: string | null
          last_error: string | null
          last_tested_at: string | null
          org_id: string
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          api_key_encrypted?: string | null
          created_at?: string
          default_from_email?: string | null
          default_from_name?: string | null
          default_reply_to?: string | null
          id?: string
          key_hint?: string | null
          last_error?: string | null
          last_tested_at?: string | null
          org_id: string
          provider?: string
          status?: string
          updated_at?: string
        }
        Update: {
          api_key_encrypted?: string | null
          created_at?: string
          default_from_email?: string | null
          default_from_name?: string | null
          default_reply_to?: string | null
          id?: string
          key_hint?: string | null
          last_error?: string | null
          last_tested_at?: string | null
          org_id?: string
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_email_integrations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_locations: {
        Row: {
          address_line_1: string
          address_line_2: string | null
          business_hours: Json
          city: string
          country: string
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          latitude: number | null
          longitude: number | null
          name: string
          notes: string | null
          org_id: string
          phone: string | null
          postal_code: string | null
          state: string | null
          updated_at: string
        }
        Insert: {
          address_line_1: string
          address_line_2?: string | null
          business_hours?: Json
          city: string
          country?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          latitude?: number | null
          longitude?: number | null
          name: string
          notes?: string | null
          org_id: string
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          updated_at?: string
        }
        Update: {
          address_line_1?: string
          address_line_2?: string | null
          business_hours?: Json
          city?: string
          country?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          latitude?: number | null
          longitude?: number | null
          name?: string
          notes?: string | null
          org_id?: string
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_locations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_folders: {
        Row: {
          created_at: string
          id: string
          name: string
          org_id: string
          parent_id: string | null
          position: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          org_id: string
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_folders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "tool_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_idempotency_keys: {
        Row: {
          agent_invocation_id: string | null
          created_at: string
          expires_at: string
          id: string
          idempotency_key: string
          organization_id: string
          request_hash: string
          response: Json
          tool_name: string
        }
        Insert: {
          agent_invocation_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key: string
          organization_id: string
          request_hash: string
          response: Json
          tool_name: string
        }
        Update: {
          agent_invocation_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          request_hash?: string
          response?: Json
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_idempotency_keys_agent_invocation_id_fkey"
            columns: ["agent_invocation_id"]
            isOneToOne: false
            referencedRelation: "agent_invocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_idempotency_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      traffic_attributions: {
        Row: {
          created_at: string
          id: string
          landing_page: string | null
          occurred_at: string
          organization_id: string
          referrer: string | null
          session_id: string | null
          touch_type: string
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          visitor_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          landing_page?: string | null
          occurred_at?: string
          organization_id: string
          referrer?: string | null
          session_id?: string | null
          touch_type: string
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visitor_id: string
        }
        Update: {
          created_at?: string
          id?: string
          landing_page?: string | null
          occurred_at?: string
          organization_id?: string
          referrer?: string | null
          session_id?: string | null
          touch_type?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "traffic_attributions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_attributions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "traffic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_attributions_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "traffic_visitors"
            referencedColumns: ["id"]
          },
        ]
      }
      traffic_events: {
        Row: {
          contact_id: string | null
          created_at: string
          event_name: string | null
          event_type: string
          id: string
          metadata: Json
          occurred_at: string
          opportunity_id: string | null
          organization_id: string
          session_id: string | null
          url: string | null
          visitor_id: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          event_name?: string | null
          event_type: string
          id?: string
          metadata?: Json
          occurred_at?: string
          opportunity_id?: string | null
          organization_id: string
          session_id?: string | null
          url?: string | null
          visitor_id?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          event_name?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          opportunity_id?: string | null
          organization_id?: string
          session_id?: string | null
          url?: string | null
          visitor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "traffic_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_events_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "traffic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_events_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "traffic_visitors"
            referencedColumns: ["id"]
          },
        ]
      }
      traffic_pageviews: {
        Row: {
          created_at: string
          duration_seconds: number | null
          id: string
          occurred_at: string
          organization_id: string
          path: string
          referrer: string | null
          session_id: string
          title: string | null
          url: string
          visitor_id: string
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          id?: string
          occurred_at?: string
          organization_id: string
          path: string
          referrer?: string | null
          session_id: string
          title?: string | null
          url: string
          visitor_id: string
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          id?: string
          occurred_at?: string
          organization_id?: string
          path?: string
          referrer?: string | null
          session_id?: string
          title?: string | null
          url?: string
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "traffic_pageviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_pageviews_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "traffic_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_pageviews_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "traffic_visitors"
            referencedColumns: ["id"]
          },
        ]
      }
      traffic_sessions: {
        Row: {
          browser: string | null
          city: string | null
          country_code: string | null
          country_name: string | null
          created_at: string
          device_type: string | null
          duration_seconds: number | null
          ended_at: string | null
          exit_page: string | null
          id: string
          is_converted: boolean
          landing_page: string | null
          organization_id: string
          os: string | null
          page_view_count: number
          referrer: string | null
          session_key: string
          started_at: string
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          visitor_id: string
        }
        Insert: {
          browser?: string | null
          city?: string | null
          country_code?: string | null
          country_name?: string | null
          created_at?: string
          device_type?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          exit_page?: string | null
          id?: string
          is_converted?: boolean
          landing_page?: string | null
          organization_id: string
          os?: string | null
          page_view_count?: number
          referrer?: string | null
          session_key: string
          started_at?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visitor_id: string
        }
        Update: {
          browser?: string | null
          city?: string | null
          country_code?: string | null
          country_name?: string | null
          created_at?: string
          device_type?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          exit_page?: string | null
          id?: string
          is_converted?: boolean
          landing_page?: string | null
          organization_id?: string
          os?: string | null
          page_view_count?: number
          referrer?: string | null
          session_key?: string
          started_at?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "traffic_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_sessions_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "traffic_visitors"
            referencedColumns: ["id"]
          },
        ]
      }
      traffic_setups: {
        Row: {
          created_at: string
          gtm_container_id: string | null
          id: string
          organization_id: string
          primary_website_url: string | null
          script_token: string
          updated_at: string
          verification_state: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          gtm_container_id?: string | null
          id?: string
          organization_id: string
          primary_website_url?: string | null
          script_token?: string
          updated_at?: string
          verification_state?: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          gtm_container_id?: string | null
          id?: string
          organization_id?: string
          primary_website_url?: string | null
          script_token?: string
          updated_at?: string
          verification_state?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "traffic_setups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      traffic_visitors: {
        Row: {
          contact_id: string | null
          created_at: string
          first_seen_at: string
          id: string
          is_identified: boolean
          last_seen_at: string
          organization_id: string
          page_view_count: number
          session_count: number
          updated_at: string
          visitor_key: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          first_seen_at?: string
          id?: string
          is_identified?: boolean
          last_seen_at?: string
          organization_id: string
          page_view_count?: number
          session_count?: number
          updated_at?: string
          visitor_key: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          first_seen_at?: string
          id?: string
          is_identified?: boolean
          last_seen_at?: string
          organization_id?: string
          page_view_count?: number
          session_count?: number
          updated_at?: string
          visitor_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "traffic_visitors_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traffic_visitors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      twilio_phone_numbers: {
        Row: {
          archived_at: string | null
          business_purpose: string | null
          capability_mms: boolean
          capability_sms: boolean
          capability_voice: boolean
          chat_routing: Json
          created_at: string
          default_routing_mode: string | null
          e164: string
          forward_to_number: string | null
          friendly_name: string
          id: string
          inbox_label: string | null
          is_active: boolean
          is_default: boolean
          notes: string | null
          organization_id: string
          phone_sid: string | null
          responsible_user_id: string | null
          updated_at: string
          vapi_assistant_id: string | null
          workflow_settings: Json
        }
        Insert: {
          archived_at?: string | null
          business_purpose?: string | null
          capability_mms?: boolean
          capability_sms?: boolean
          capability_voice?: boolean
          chat_routing?: Json
          created_at?: string
          default_routing_mode?: string | null
          e164: string
          forward_to_number?: string | null
          friendly_name: string
          id?: string
          inbox_label?: string | null
          is_active?: boolean
          is_default?: boolean
          notes?: string | null
          organization_id: string
          phone_sid?: string | null
          responsible_user_id?: string | null
          updated_at?: string
          vapi_assistant_id?: string | null
          workflow_settings?: Json
        }
        Update: {
          archived_at?: string | null
          business_purpose?: string | null
          capability_mms?: boolean
          capability_sms?: boolean
          capability_voice?: boolean
          chat_routing?: Json
          created_at?: string
          default_routing_mode?: string | null
          e164?: string
          forward_to_number?: string | null
          friendly_name?: string
          id?: string
          inbox_label?: string | null
          is_active?: boolean
          is_default?: boolean
          notes?: string | null
          organization_id?: string
          phone_sid?: string | null
          responsible_user_id?: string | null
          updated_at?: string
          vapi_assistant_id?: string | null
          workflow_settings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "twilio_phone_numbers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_active_org: {
        Row: {
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_active_org_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_availability: {
        Row: {
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          org_id: string
          start_time: string
          user_id: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          org_id: string
          start_time: string
          user_id: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          org_id?: string
          start_time?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_availability_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_cloud_accounts: {
        Row: {
          access_token_encrypted: string
          app_secret_encrypted: string | null
          created_at: string
          created_by: string | null
          display_name: string
          id: string
          is_active: boolean
          last_error: string | null
          last_synced_at: string | null
          org_id: string
          phone_number_e164: string | null
          phone_number_id: string
          status: string
          updated_at: string
          waba_id: string
          webhook_verify_token_encrypted: string | null
        }
        Insert: {
          access_token_encrypted: string
          app_secret_encrypted?: string | null
          created_at?: string
          created_by?: string | null
          display_name: string
          id?: string
          is_active?: boolean
          last_error?: string | null
          last_synced_at?: string | null
          org_id: string
          phone_number_e164?: string | null
          phone_number_id: string
          status?: string
          updated_at?: string
          waba_id: string
          webhook_verify_token_encrypted?: string | null
        }
        Update: {
          access_token_encrypted?: string
          app_secret_encrypted?: string | null
          created_at?: string
          created_by?: string | null
          display_name?: string
          id?: string
          is_active?: boolean
          last_error?: string | null
          last_synced_at?: string | null
          org_id?: string
          phone_number_e164?: string | null
          phone_number_id?: string
          status?: string
          updated_at?: string
          waba_id?: string
          webhook_verify_token_encrypted?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_cloud_accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_providers: {
        Row: {
          config_encrypted: string
          connected_at: string | null
          created_at: string
          created_by: string | null
          display_name: string
          id: string
          is_active: boolean
          last_error: string | null
          org_id: string
          phone_number: string | null
          provider: Database["public"]["Enums"]["whatsapp_provider_type"]
          status: string
          updated_at: string
          webhook_secret_encrypted: string | null
        }
        Insert: {
          config_encrypted: string
          connected_at?: string | null
          created_at?: string
          created_by?: string | null
          display_name?: string
          id?: string
          is_active?: boolean
          last_error?: string | null
          org_id: string
          phone_number?: string | null
          provider: Database["public"]["Enums"]["whatsapp_provider_type"]
          status?: string
          updated_at?: string
          webhook_secret_encrypted?: string | null
        }
        Update: {
          config_encrypted?: string
          connected_at?: string | null
          created_at?: string
          created_by?: string | null
          display_name?: string
          id?: string
          is_active?: boolean
          last_error?: string | null
          org_id?: string
          phone_number?: string | null
          provider?: Database["public"]["Enums"]["whatsapp_provider_type"]
          status?: string
          updated_at?: string
          webhook_secret_encrypted?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_providers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_templates: {
        Row: {
          body_variable_count: number
          category: string
          cloud_account_id: string
          components: Json
          header_variable_count: number
          id: string
          language: string
          meta_template_id: string
          name: string
          org_id: string
          status: string
          synced_at: string
        }
        Insert: {
          body_variable_count?: number
          category: string
          cloud_account_id: string
          components: Json
          header_variable_count?: number
          id?: string
          language: string
          meta_template_id: string
          name: string
          org_id: string
          status: string
          synced_at?: string
        }
        Update: {
          body_variable_count?: number
          category?: string
          cloud_account_id?: string
          components?: Json
          header_variable_count?: number
          id?: string
          language?: string
          meta_template_id?: string
          name?: string
          org_id?: string
          status?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_templates_cloud_account_id_fkey"
            columns: ["cloud_account_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_cloud_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_authoring_runs: {
        Row: {
          conversation_id: string | null
          created_at: string
          error_types: string[]
          id: string
          org_id: string
          outcome: string
          user_id: string | null
          validation_error_count: number
          workflow_id: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          error_types?: string[]
          id?: string
          org_id: string
          outcome: string
          user_id?: string | null
          validation_error_count?: number
          workflow_id?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          error_types?: string[]
          id?: string
          org_id?: string
          outcome?: string
          user_id?: string | null
          validation_error_count?: number
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_authoring_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_authoring_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_folders: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          icon: string | null
          id: string
          name: string
          org_id: string
          parent_id: string | null
          position: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          icon?: string | null
          id?: string
          name: string
          org_id: string
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          icon?: string | null
          id?: string
          name?: string
          org_id?: string
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_folders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "workflow_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_run_steps: {
        Row: {
          created_at: string
          ended_at: string | null
          error: string | null
          id: string
          input: Json
          node_id: string
          node_type: string
          output: Json
          run_id: string
          started_at: string | null
          status: string
          step_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          error?: string | null
          id?: string
          input?: Json
          node_id: string
          node_type: string
          output?: Json
          run_id: string
          started_at?: string | null
          status?: string
          step_id: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          error?: string | null
          id?: string
          input?: Json
          node_id?: string
          node_type?: string
          output?: Json
          run_id?: string
          started_at?: string | null
          status?: string
          step_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_run_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_runs: {
        Row: {
          created_at: string
          created_by: string | null
          ended_at: string | null
          error: string | null
          id: string
          org_id: string
          started_at: string | null
          state: Json
          status: string
          trigger_payload: Json
          trigger_type: string
          workflow_id: string
          workflow_version_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          error?: string | null
          id?: string
          org_id: string
          started_at?: string | null
          state?: Json
          status?: string
          trigger_payload?: Json
          trigger_type?: string
          workflow_id: string
          workflow_version_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          error?: string | null
          id?: string
          org_id?: string
          started_at?: string | null
          state?: Json
          status?: string
          trigger_payload?: Json
          trigger_type?: string
          workflow_id?: string
          workflow_version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_workflow_version_id_fkey"
            columns: ["workflow_version_id"]
            isOneToOne: false
            referencedRelation: "workflow_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_triggers: {
        Row: {
          created_at: string
          enabled: boolean
          event_type: string
          filter: Json
          id: string
          org_id: string
          schedule_cron: string | null
          updated_at: string
          workflow_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          event_type: string
          filter?: Json
          id?: string
          org_id: string
          schedule_cron?: string | null
          updated_at?: string
          workflow_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          event_type?: string
          filter?: Json
          id?: string
          org_id?: string
          schedule_cron?: string | null
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_triggers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_triggers_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_versions: {
        Row: {
          created_at: string
          created_by: string | null
          definition: Json
          id: string
          notes: string | null
          version_number: number
          workflow_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          definition?: Json
          id?: string
          notes?: string | null
          version_number: number
          workflow_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          definition?: Json
          id?: string
          notes?: string | null
          version_number?: number
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_versions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_waits: {
        Row: {
          created_at: string
          event_filter: Json
          id: string
          run_id: string
          satisfied_at: string | null
          timeout_at: string | null
        }
        Insert: {
          created_at?: string
          event_filter?: Json
          id?: string
          run_id: string
          satisfied_at?: string | null
          timeout_at?: string | null
        }
        Update: {
          created_at?: string
          event_filter?: Json
          id?: string
          run_id?: string
          satisfied_at?: string | null
          timeout_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_waits_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          current_version_id: string | null
          deleted_at: string | null
          description: string | null
          folder_id: string | null
          health_blocked: boolean
          health_blocked_reason: string | null
          id: string
          is_active: boolean
          kind: string
          legacy_tool_config_id: string | null
          name: string
          org_id: string
          position: number
          slug: string
          tool_name: string | null
          trigger_config: Json
          trigger_type: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          deleted_at?: string | null
          description?: string | null
          folder_id?: string | null
          health_blocked?: boolean
          health_blocked_reason?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          legacy_tool_config_id?: string | null
          name: string
          org_id: string
          position?: number
          slug: string
          tool_name?: string | null
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          deleted_at?: string | null
          description?: string | null
          folder_id?: string | null
          health_blocked?: boolean
          health_blocked_reason?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          legacy_tool_config_id?: string | null
          name?: string
          org_id?: string
          position?: number
          slug?: string
          tool_name?: string | null
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflows_current_version_id_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "workflow_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "workflow_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      agent_tools_resolved: {
        Row: {
          action_type: string | null
          agent_id: string | null
          allowed_channels:
            | Database["public"]["Enums"]["agent_channel"][]
            | null
          config: Json | null
          created_at: string | null
          id: string | null
          is_active: boolean | null
          organization_id: string | null
          source: string | null
          source_id: string | null
          tool_name: string | null
          workflow_id: string | null
          workflow_kind: string | null
        }
        Relationships: []
      }
      unified_calls: {
        Row: {
          assistant_id: string | null
          call_type: string | null
          contact_id: string | null
          cost: number | null
          counterpart_name: string | null
          counterpart_number: string | null
          created_at: string | null
          direction: string | null
          duration_seconds: number | null
          ended_at: string | null
          external_id: string | null
          id: string | null
          notes: string | null
          org_id: string | null
          recording_duration: number | null
          recording_url: string | null
          routing_mode: string | null
          started_at: string | null
          status: string | null
          substatus: string | null
          transcript: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _is_cluster_fully_excluded: {
        Args: { p_contact_ids: string[]; p_org_id: string }
        Returns: boolean
      }
      clear_workflows_blocked_by_integration: {
        Args: { p_integration_id: string }
        Returns: number
      }
      fn_seed_default_pipeline_for_org: {
        Args: { p_org_id: string }
        Returns: string
      }
      get_ads_attribution: {
        Args: { p_from: string; p_platform?: string; p_to: string }
        Returns: {
          identified_contacts: number
          opportunities: number
          revenue: number
          sessions: number
          utm_campaign: string
          utm_medium: string
          utm_source: string
        }[]
      }
      get_current_org_id: { Args: never; Returns: string }
      get_org_member_profiles: {
        Args: { p_org_id: string; p_page?: number; p_per_page?: number }
        Returns: {
          email: string
          full_name: string
          id: string
          joined_at: string
          phone: string
          role: string
          total_count: number
          user_id: string
        }[]
      }
      get_tag_usage: {
        Args: { p_org_id: string }
        Returns: {
          contact_count: number
          opportunity_count: number
          tag_id: string
        }[]
      }
      get_user_org_ids: { Args: never; Returns: string[] }
      mark_workflows_blocked_by_integration: {
        Args: { p_integration_id: string; p_reason: string }
        Returns: number
      }
      match_documents: {
        Args: { filter?: Json; query_embedding: string }
        Returns: {
          content: string
          id: number
          metadata: Json
          similarity: number
        }[]
      }
      merge_contacts: {
        Args: { archived_id: string; survivor_id: string }
        Returns: undefined
      }
      next_agent_prompt_version: {
        Args: { p_agent_id: string }
        Returns: number
      }
      normalize_phone: { Args: { input: string }; Returns: string }
      refresh_contact_duplicate_audit: { Args: never; Returns: undefined }
    }
    Enums: {
      action_type:
        | "create_contact"
        | "get_availability"
        | "create_appointment"
        | "send_sms"
        | "knowledge_base"
        | "custom_webhook"
        | "manychat_set_field"
        | "manychat_add_tag"
        | "manychat_trigger_flow"
        | "manychat_send_message"
        | "google_contacts_create"
        | "google_contacts_update"
        | "google_contacts_find"
        | "google_contacts_delete"
        | "send_telegram_notification"
        | "pipeline_move_opportunity"
        | "pipeline_update_opportunity"
        | "pipeline_mark_won"
        | "pipeline_mark_lost"
        | "pipeline_add_note"
        | "pipeline_assign_user"
        | "pipeline_create_opportunity"
        | "create_task"
        | "create_note"
        | "send_whatsapp_template"
      agent_channel:
        | "web_widget"
        | "whatsapp"
        | "messenger"
        | "instagram"
        | "manychat"
        | "telegram"
        | "sms"
      agent_invocation_mode: "production" | "playground"
      agent_invocation_status:
        | "success"
        | "error"
        | "aborted"
        | "skipped"
        | "denied"
        | "running"
      contact_import_dedup_strategy:
        | "skip_existing"
        | "update_existing"
        | "create_duplicate"
      contact_import_status:
        | "uploading"
        | "parsing"
        | "previewing"
        | "queued"
        | "processing"
        | "completed"
        | "partial"
        | "failed"
        | "cancelled"
      crm_entity_type: "contact" | "account" | "opportunity"
      custom_field_entity: "contact" | "opportunity" | "account"
      custom_field_type:
        | "text"
        | "long_text"
        | "number"
        | "integer"
        | "boolean"
        | "date"
        | "datetime"
        | "select"
        | "multi_select"
        | "url"
        | "email"
        | "phone"
        | "currency"
      integration_provider:
        | "gohighlevel"
        | "twilio"
        | "calcom"
        | "custom_webhook"
        | "openai"
        | "anthropic"
        | "openrouter"
        | "vapi"
        | "manychat"
        | "google_contacts"
        | "telegram"
      project_actor_type: "human" | "ai_agent" | "system"
      project_audit_status: "success" | "failed" | "blocked"
      project_dependency_rule:
        | "after_done"
        | "after_delivered"
        | "after_approved"
      project_execution_status:
        | "not_started"
        | "in_progress"
        | "delivered"
        | "failed"
        | "cancelled"
      project_executor_type: "human" | "ai" | "system" | "automation"
      project_mcp_area: "general_xphere" | "projects" | "oauth"
      project_run_environment:
        | "manual"
        | "gsd"
        | "claude_code"
        | "codex"
        | "ide"
        | "other"
      project_run_status:
        | "running"
        | "paused"
        | "delivered"
        | "failed"
        | "cancelled"
      project_task_step: "backlog" | "todo" | "doing" | "done"
      project_validation_status:
        | "not_required"
        | "needs_review"
        | "approved"
        | "changes_requested"
        | "rejected"
      project_view_scope: "personal" | "project"
      project_view_type: "board" | "list" | "calendar" | "timeline"
      task_priority: "low" | "medium" | "high" | "urgent"
      task_status: "todo" | "in_progress" | "done" | "cancelled"
      user_role: "admin" | "member"
      whatsapp_provider_type: "evolution" | "zapi" | "wapi"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      action_type: [
        "create_contact",
        "get_availability",
        "create_appointment",
        "send_sms",
        "knowledge_base",
        "custom_webhook",
        "manychat_set_field",
        "manychat_add_tag",
        "manychat_trigger_flow",
        "manychat_send_message",
        "google_contacts_create",
        "google_contacts_update",
        "google_contacts_find",
        "google_contacts_delete",
        "send_telegram_notification",
        "pipeline_move_opportunity",
        "pipeline_update_opportunity",
        "pipeline_mark_won",
        "pipeline_mark_lost",
        "pipeline_add_note",
        "pipeline_assign_user",
        "pipeline_create_opportunity",
        "create_task",
        "create_note",
        "send_whatsapp_template",
      ],
      agent_channel: [
        "web_widget",
        "whatsapp",
        "messenger",
        "instagram",
        "manychat",
        "telegram",
        "sms",
      ],
      agent_invocation_mode: ["production", "playground"],
      agent_invocation_status: [
        "success",
        "error",
        "aborted",
        "skipped",
        "denied",
        "running",
      ],
      contact_import_dedup_strategy: [
        "skip_existing",
        "update_existing",
        "create_duplicate",
      ],
      contact_import_status: [
        "uploading",
        "parsing",
        "previewing",
        "queued",
        "processing",
        "completed",
        "partial",
        "failed",
        "cancelled",
      ],
      crm_entity_type: ["contact", "account", "opportunity"],
      custom_field_entity: ["contact", "opportunity", "account"],
      custom_field_type: [
        "text",
        "long_text",
        "number",
        "integer",
        "boolean",
        "date",
        "datetime",
        "select",
        "multi_select",
        "url",
        "email",
        "phone",
        "currency",
      ],
      integration_provider: [
        "gohighlevel",
        "twilio",
        "calcom",
        "custom_webhook",
        "openai",
        "anthropic",
        "openrouter",
        "vapi",
        "manychat",
        "google_contacts",
        "telegram",
      ],
      project_actor_type: ["human", "ai_agent", "system"],
      project_audit_status: ["success", "failed", "blocked"],
      project_dependency_rule: [
        "after_done",
        "after_delivered",
        "after_approved",
      ],
      project_execution_status: [
        "not_started",
        "in_progress",
        "delivered",
        "failed",
        "cancelled",
      ],
      project_executor_type: ["human", "ai", "system", "automation"],
      project_mcp_area: ["general_xphere", "projects", "oauth"],
      project_run_environment: [
        "manual",
        "gsd",
        "claude_code",
        "codex",
        "ide",
        "other",
      ],
      project_run_status: [
        "running",
        "paused",
        "delivered",
        "failed",
        "cancelled",
      ],
      project_task_step: ["backlog", "todo", "doing", "done"],
      project_validation_status: [
        "not_required",
        "needs_review",
        "approved",
        "changes_requested",
        "rejected",
      ],
      project_view_scope: ["personal", "project"],
      project_view_type: ["board", "list", "calendar", "timeline"],
      task_priority: ["low", "medium", "high", "urgent"],
      task_status: ["todo", "in_progress", "done", "cancelled"],
      user_role: ["admin", "member"],
      whatsapp_provider_type: ["evolution", "zapi", "wapi"],
    },
  },
} as const
