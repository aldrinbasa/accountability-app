
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "commitment_versions": {
                  Row: {
                    "commitment_id": string,"created_at": string,"days": (number)[] | null,"effective_week_start": string,"end_date": string | null,"group_id": string,"id": string,"target": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "commitment_id": string,"created_at"?: string,"days"?: (number)[] | null,"effective_week_start": string,"end_date"?: string | null,"group_id": string,"id"?: string,"target"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "commitment_id"?: string,"created_at"?: string,"days"?: (number)[] | null,"effective_week_start"?: string,"end_date"?: string | null,"group_id"?: string,"id"?: string,"target"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "commitment_versions_commitment_id_fkey"
      columns: ["commitment_id"]
isOneToOne: false
      referencedRelation: "commitments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "commitment_versions_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    }
                  ]
                },"commitments": {
                  Row: {
                    "created_at": string,"ends_after_week_start": string | null,"group_activity_id": string,"group_id": string,"id": string,"kind": string,"membership_id": string,"schedule_type": string | null,"sessions_through": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"ends_after_week_start"?: string | null,"group_activity_id": string,"group_id": string,"id"?: string,"kind": string,"membership_id": string,"schedule_type"?: string | null,"sessions_through"?: string | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"ends_after_week_start"?: string | null,"group_activity_id"?: string,"group_id"?: string,"id"?: string,"kind"?: string,"membership_id"?: string,"schedule_type"?: string | null,"sessions_through"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "commitments_group_activity_id_fkey"
      columns: ["group_activity_id"]
isOneToOne: false
      referencedRelation: "group_activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "commitments_group_activity_id_fkey"
      columns: ["group_activity_id"]
isOneToOne: false
      referencedRelation: "group_activity_options"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "commitments_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "commitments_membership_id_fkey"
      columns: ["membership_id"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "commitments_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"group_activities": {
                  Row: {
                    "created_at": string,"created_by": string,"custom_name": string | null,"group_id": string,"id": string,"preset_key": string | null,"schedule_type": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"custom_name"?: string | null,"group_id": string,"id"?: string,"preset_key"?: string | null,"schedule_type"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"custom_name"?: string | null,"group_id"?: string,"id"?: string,"preset_key"?: string | null,"schedule_type"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_activities_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "group_activities_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "group_activities_preset_key_fkey"
      columns: ["preset_key"]
isOneToOne: false
      referencedRelation: "preset_activities"
      referencedColumns: ["key"]
    }
                  ]
                },"group_weeks": {
                  Row: {
                    "created_at": string,"group_id": string,"lock_at": string,"updated_at": string,"week_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"group_id": string,"lock_at": string,"updated_at"?: string,"week_start": string
                  }
                  Update: {
                    "created_at"?: string,"group_id"?: string,"lock_at"?: string,"updated_at"?: string,"week_start"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_weeks_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    }
                  ]
                },"groups": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"name": string,"time_zone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"time_zone": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"time_zone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "groups_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"heartbeat": {
                  Row: {
                    "id": boolean,"last_error": string | null,"last_error_at": string | null,"last_error_step": number | null,"last_run_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: boolean,"last_error"?: string | null,"last_error_at"?: string | null,"last_error_step"?: number | null,"last_run_at"?: string | null
                  }
                  Update: {
                    "id"?: boolean,"last_error"?: string | null,"last_error_at"?: string | null,"last_error_step"?: number | null,"last_run_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"invites": {
                  Row: {
                    "code": string,"created_at": string,"created_by": string | null,"expires_at": string,"group_id": string,"id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"created_by"?: string | null,"expires_at": string,"group_id": string,"id"?: string,"updated_at"?: string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"created_by"?: string | null,"expires_at"?: string,"group_id"?: string,"id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invites_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invites_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "created_at": string,"end_reason": string | null,"ended_at": string | null,"group_id": string,"id": string,"joined_at": string,"role": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"end_reason"?: string | null,"ended_at"?: string | null,"group_id": string,"id"?: string,"joined_at"?: string,"role": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"end_reason"?: string | null,"ended_at"?: string | null,"group_id"?: string,"id"?: string,"joined_at"?: string,"role"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "memberships_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"preset_activities": {
                  Row: {
                    "category": string,"key": string,"name": string,"sort": number
                  }
                  ComputedFields: never
                  Insert: {
                    "category": string,"key": string,"name": string,"sort": number
                  }
                  Update: {
                    "category"?: string,"key"?: string,"name"?: string,"sort"?: number
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "avatar_path": string | null,"created_at": string,"display_name": string,"id": string,"time_zone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_path"?: string | null,"created_at"?: string,"display_name": string,"id": string,"time_zone": string,"updated_at"?: string
                  }
                  Update: {
                    "avatar_path"?: string | null,"created_at"?: string,"display_name"?: string,"id"?: string,"time_zone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"sessions": {
                  Row: {
                    "commitment_id": string,"created_at": string,"ends_at": string,"group_id": string,"id": string,"membership_id": string,"miss_recorded_at": string | null,"slot": number,"starts_at": string,"updated_at": string,"user_id": string,"week_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "commitment_id": string,"created_at"?: string,"ends_at": string,"group_id": string,"id"?: string,"membership_id": string,"miss_recorded_at"?: string | null,"slot": number,"starts_at": string,"updated_at"?: string,"user_id": string,"week_start": string
                  }
                  Update: {
                    "commitment_id"?: string,"created_at"?: string,"ends_at"?: string,"group_id"?: string,"id"?: string,"membership_id"?: string,"miss_recorded_at"?: string | null,"slot"?: number,"starts_at"?: string,"updated_at"?: string,"user_id"?: string,"week_start"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sessions_commitment_id_fkey"
      columns: ["commitment_id"]
isOneToOne: false
      referencedRelation: "commitments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sessions_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sessions_membership_id_fkey"
      columns: ["membership_id"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sessions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "group_activity_options": {
                  Row: {
                    "created_by": string,"custom_name": string | null,"group_id": string,"id": string,"locked_schedule_type": string | null,"preset_key": string | null
                  }
                  ComputedFields: never
                  Insert: {
                           "created_by"?: string | null,"custom_name"?: string | null,"group_id"?: string | null,"id"?: string | null,"locked_schedule_type"?: never,"preset_key"?: string | null
                         }
                        Update: {
                           "created_by"?: string | null,"custom_name"?: string | null,"group_id"?: string | null,"id"?: string | null,"locked_schedule_type"?: never,"preset_key"?: string | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "group_activities_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "group_activities_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "group_activities_preset_key_fkey"
      columns: ["preset_key"]
isOneToOne: false
      referencedRelation: "preset_activities"
      referencedColumns: ["key"]
    }
                  ]
                }
          }
          Functions: {
            "add_commitment":
{ Args: { "p_custom_name"?: string,"p_days"?: (number)[],"p_end_date"?: string,"p_group_activity_id"?: string,"p_group_id": string,"p_preset_key"?: string,"p_schedule_type"?: string,"p_target"?: number }; Returns: {
              "commitment_id": string,"starts_on": string
            }[]
                           },
"create_group":
{ Args: { "p_name": string }; Returns: string
                           },
"create_invite":
{ Args: { "p_group_id": string,"p_new"?: boolean }; Returns: {
              "code": string,"expires_at": string
            }[]
                           },
"get_invite":
{ Args: { "p_code": string }; Returns: {
              "admin_display_name": string,"group_id": string,"group_name": string,"member_count": number,"status": string
            }[]
                           },
"join_group":
{ Args: { "p_code": string }; Returns: string
                           },
"leave_group":
{ Args: { "p_group_id": string }; Returns: undefined
                           },
"plan_preview":
{ Args: { "p_end_date"?: string,"p_group_id": string,"p_target"?: number }; Returns: {
              "last_week_target": number,"member_today": string,"min_end_date": string,"starts_on": string,"week_end": string,"week_start": string
            }[]
                           },
"remove_member":
{ Args: { "p_group_id": string,"p_user_id": string }; Returns: undefined
                           },
"save_profile":
{ Args: { "p_display_name": string,"p_time_zone": string }; Returns: {
              "avatar_path": string | null,
"created_at": string,
"display_name": string,
"id": string,
"time_zone": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "profiles"
        isOneToOne: true
        isSetofReturn: false
      } }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
